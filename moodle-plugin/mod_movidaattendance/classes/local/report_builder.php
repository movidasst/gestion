<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\local;

defined('MOODLE_INTERNAL') || die();

/** Builds reusable attendance reports for Moodle pages and external services. */
final class report_builder {
    /** Build a consolidated course attendance report. */
    public static function get_course_report(int $courseid, int $groupid = 0): array {
        global $DB, $USER;

        $course = get_course($courseid);
        self::validate_group($courseid, $groupid);
        $modinfo = get_fast_modinfo($course);
        $cms = array_values($modinfo->get_instances_of('movidaattendance'));
        $cms = array_values(array_filter($cms, static function(\cm_info $cm): bool {
            return empty($cm->deletioninprogress)
                && has_capability('mod/movidaattendance:viewreports', $cm->context);
        }));

        $instanceids = array_map(static fn(\cm_info $cm): int => (int)$cm->instance, $cms);
        $attendances = $instanceids
            ? $DB->get_records_list('movidaattendance', 'id', $instanceids)
            : [];
        $records = $instanceids
            ? $DB->get_records_list(
                'movidaattendance_records',
                'attendanceid',
                $instanceids,
                '',
                'id,attendanceid,userid,groupid,status,timecreated'
            )
            : [];

        $recordsbyactivity = [];
        foreach ($records as $record) {
            $recordsbyactivity[(int)$record->attendanceid][(int)$record->userid] = $record;
        }

        $users = [];
        $activities = [];
        foreach ($cms as $cm) {
            $attendance = $attendances[$cm->instance] ?? null;
            if (!$attendance) {
                continue;
            }
            if ($groupid && !has_capability('moodle/site:accessallgroups', $cm->context)) {
                $callerGroups = groups_get_all_groups($courseid, $USER->id, $cm->groupingid, 'g.id');
                if (!isset($callerGroups[$groupid])) {
                    throw new \required_capability_exception(
                        $cm->context,
                        'moodle/site:accessallgroups',
                        'nopermissions',
                        ''
                    );
                }
            }
            $participants = get_enrolled_users(
                $cm->context,
                'mod/movidaattendance:checkin',
                $groupid,
                'u.id,u.username,u.firstname,u.lastname,u.firstnamephonetic,u.lastnamephonetic,'
                    . 'u.middlename,u.alternatename,u.email,u.idnumber',
                'u.lastname,u.firstname'
            );
            $window = attendance_manager::window_state($attendance);
            $activitysummary = [
                'id' => (int)$attendance->id,
                'cmid' => (int)$cm->id,
                'name' => format_string($attendance->name, true, ['context' => $cm->context]),
                'timeopen' => (int)$attendance->timeopen,
                'timeclose' => (int)$attendance->timeclose,
                'lateuntil' => (int)$attendance->lateuntil,
                'windowstate' => $window,
                'participants' => count($participants),
                'expected' => 0,
                'registered' => 0,
                'present' => 0,
                'late' => 0,
                'missed' => 0,
                'pending' => 0,
                'upcoming' => 0,
            ];

            foreach ($participants as $user) {
                $userid = (int)$user->id;
                if (!isset($users[$userid])) {
                    $users[$userid] = [
                        'userid' => $userid,
                        'fullname' => fullname($user),
                        'email' => (string)$user->email,
                        'idnumber' => (string)$user->idnumber,
                        'scheduled' => 0,
                        'expected' => 0,
                        'registered' => 0,
                        'present' => 0,
                        'late' => 0,
                        'missed' => 0,
                        'pending' => 0,
                        'upcoming' => 0,
                        'hasdue' => false,
                        'percentage' => 0.0,
                        'lastcheckin' => 0,
                    ];
                }

                $record = $recordsbyactivity[$attendance->id][$userid] ?? null;
                $users[$userid]['scheduled']++;
                if ($window === attendance_manager::WINDOW_BEFORE && !$record) {
                    $users[$userid]['upcoming']++;
                    $activitysummary['upcoming']++;
                    continue;
                }

                $users[$userid]['expected']++;
                $users[$userid]['hasdue'] = true;
                $activitysummary['expected']++;
                if ($record) {
                    $users[$userid]['registered']++;
                    $activitysummary['registered']++;
                    if ($record->status === attendance_manager::STATUS_LATE) {
                        $users[$userid]['late']++;
                        $activitysummary['late']++;
                    } else {
                        $users[$userid]['present']++;
                        $activitysummary['present']++;
                    }
                    $users[$userid]['lastcheckin'] = max(
                        $users[$userid]['lastcheckin'],
                        (int)$record->timecreated
                    );
                } else if ($window === attendance_manager::WINDOW_CLOSED) {
                    $users[$userid]['missed']++;
                    $activitysummary['missed']++;
                } else {
                    $users[$userid]['pending']++;
                    $activitysummary['pending']++;
                }
            }
            $activities[] = $activitysummary;
        }

        foreach ($users as &$user) {
            $user['percentage'] = $user['expected']
                ? round($user['registered'] * 1000 / $user['expected']) / 10
                : 0.0;
        }
        unset($user);
        usort($users, static fn(array $left, array $right): int => strcasecmp($left['fullname'], $right['fullname']));

        $userswithdue = array_values(array_filter($users, static fn(array $user): bool => $user['hasdue']));
        $average = $userswithdue
            ? round(array_sum(array_column($userswithdue, 'percentage')) * 10 / count($userswithdue)) / 10
            : 0.0;

        return [
            'courseid' => $courseid,
            'coursefullname' => format_string($course->fullname),
            'groupid' => $groupid,
            'generatedat' => time(),
            'summary' => [
                'activities' => count($activities),
                'participants' => count($users),
                'expected' => array_sum(array_column($users, 'expected')),
                'registered' => array_sum(array_column($users, 'registered')),
                'present' => array_sum(array_column($users, 'present')),
                'late' => array_sum(array_column($users, 'late')),
                'missed' => array_sum(array_column($users, 'missed')),
                'pending' => array_sum(array_column($users, 'pending')),
                'upcoming' => array_sum(array_column($users, 'upcoming')),
                'averagepercentage' => $average,
                'lastcheckin' => $users ? max(array_column($users, 'lastcheckin')) : 0,
            ],
            'activities' => $activities,
            'users' => array_values($users),
        ];
    }

    /** Build the report for a single attendance activity. */
    public static function get_instance_report(\stdClass $attendance, \stdClass $cm, int $groupid = 0): array {
        global $DB;

        self::validate_group((int)$attendance->course, $groupid);
        $participants = get_enrolled_users(
            \context_module::instance($cm->id),
            'mod/movidaattendance:checkin',
            $groupid,
            'u.id,u.username,u.firstname,u.lastname,u.firstnamephonetic,u.lastnamephonetic,'
                . 'u.middlename,u.alternatename,u.email,u.idnumber',
            'u.lastname,u.firstname'
        );
        $records = $DB->get_records('movidaattendance_records', ['attendanceid' => $attendance->id]);
        $recordmap = [];
        foreach ($records as $record) {
            $recordmap[(int)$record->userid] = $record;
        }
        $window = attendance_manager::window_state($attendance);
        $rows = [];
        foreach ($participants as $user) {
            $record = $recordmap[(int)$user->id] ?? null;
            if ($record) {
                $status = (string)$record->status;
            } else if ($window === attendance_manager::WINDOW_BEFORE) {
                $status = 'upcoming';
            } else if ($window === attendance_manager::WINDOW_CLOSED) {
                $status = 'missed';
            } else {
                $status = 'pending';
            }
            $groupnames = [];
            if (!$groupid && groups_get_activity_groupmode($cm)) {
                $usergroups = groups_get_all_groups($attendance->course, $user->id, $cm->groupingid, 'g.id,g.name');
                $groupnames = array_map(static fn(\stdClass $group): string => format_string($group->name), $usergroups);
            } else if ($groupid) {
                $groupnames[] = groups_get_group_name($groupid);
            }
            $rows[] = [
                'userid' => (int)$user->id,
                'fullname' => fullname($user),
                'email' => (string)$user->email,
                'idnumber' => (string)$user->idnumber,
                'groupname' => implode(', ', $groupnames),
                'status' => $status,
                'timecreated' => $record ? (int)$record->timecreated : 0,
            ];
        }
        $registered = count(array_filter($rows, static fn(array $row): bool => in_array(
            $row['status'],
            [attendance_manager::STATUS_PRESENT, attendance_manager::STATUS_LATE],
            true
        )));
        return [
            'windowstate' => $window,
            'rows' => $rows,
            'summary' => [
                'participants' => count($rows),
                'registered' => $registered,
                'present' => count(array_filter($rows, static fn(array $row): bool => $row['status'] === 'present')),
                'late' => count(array_filter($rows, static fn(array $row): bool => $row['status'] === 'late')),
                'unregistered' => count($rows) - $registered,
            ],
        ];
    }

    /** Ensure the group belongs to the requested course. */
    private static function validate_group(int $courseid, int $groupid): void {
        if (!$groupid) {
            return;
        }
        $group = groups_get_group($groupid);
        if (!$group || (int)$group->courseid !== $courseid) {
            throw new \invalid_parameter_exception('The group does not belong to the requested course.');
        }
    }
}
