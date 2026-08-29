<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\local;

defined('MOODLE_INTERNAL') || die();

/** Core attendance operations. */
final class attendance_manager {
    public const STATUS_PRESENT = 'present';
    public const STATUS_LATE = 'late';
    public const WINDOW_BEFORE = 'before_open';
    public const WINDOW_OPEN = 'open';
    public const WINDOW_LATE = 'late';
    public const WINDOW_CLOSED = 'closed';

    /** Determine the current window state. */
    public static function window_state(\stdClass $attendance, ?int $now = null): string {
        $now ??= time();
        if (!empty($attendance->timeopen) && $now < (int)$attendance->timeopen) {
            return self::WINDOW_BEFORE;
        }
        if (empty($attendance->timeclose) || $now <= (int)$attendance->timeclose) {
            return self::WINDOW_OPEN;
        }
        if (!empty($attendance->lateuntil) && $now <= (int)$attendance->lateuntil) {
            return self::WINDOW_LATE;
        }
        return self::WINDOW_CLOSED;
    }

    /** Record one student's self check-in. */
    public static function checkin(
        \stdClass $attendance,
        \stdClass $cm,
        \stdClass $course,
        int $userid
    ): \stdClass {
        global $DB;

        $existing = $DB->get_record('movidaattendance_records', [
            'attendanceid' => $attendance->id,
            'userid' => $userid,
        ]);
        if ($existing) {
            $existing->wascreated = false;
            return $existing;
        }

        $window = self::window_state($attendance);
        if ($window === self::WINDOW_BEFORE) {
            throw new \moodle_exception('notopenyet', 'mod_movidaattendance');
        }
        if ($window === self::WINDOW_CLOSED) {
            throw new \moodle_exception('closed', 'mod_movidaattendance');
        }

        $groupid = 0;
        if (groups_get_activity_groupmode($cm)) {
            $groups = groups_get_all_groups($course->id, $userid, $cm->groupingid, 'g.id');
            if ($groups) {
                $groupid = (int)array_key_first($groups);
            }
        }

        $record = (object)[
            'attendanceid' => (int)$attendance->id,
            'userid' => $userid,
            'groupid' => $groupid,
            'status' => $window === self::WINDOW_LATE ? self::STATUS_LATE : self::STATUS_PRESENT,
            'timecreated' => time(),
        ];

        try {
            $record->id = $DB->insert_record('movidaattendance_records', $record);
        } catch (\dml_exception $error) {
            $existing = $DB->get_record('movidaattendance_records', [
                'attendanceid' => $attendance->id,
                'userid' => $userid,
            ]);
            if (!$existing) {
                throw $error;
            }
            $existing->wascreated = false;
            return $existing;
        }

        $record->wascreated = true;
        \mod_movidaattendance\event\checkin_created::create_from_record($record, $attendance, $cm, $course)->trigger();

        $completion = new \completion_info($course);
        if ($completion->is_enabled($cm) && !empty($attendance->completioncheckin)) {
            $completion->update_state($cm, COMPLETION_COMPLETE, $userid);
        }
        return $record;
    }
}

