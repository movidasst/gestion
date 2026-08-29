<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\helper;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

defined('MOODLE_INTERNAL') || die();

/** Privacy provider for attendance records. */
class provider implements
        \core_privacy\local\metadata\provider,
        \core_privacy\local\request\plugin\provider,
        \core_privacy\local\request\core_userlist_provider {
    public static function get_metadata(collection $items): collection {
        $items->add_database_table('movidaattendance_records', [
            'attendanceid' => 'privacy:metadata:records:attendanceid',
            'userid' => 'privacy:metadata:records:userid',
            'groupid' => 'privacy:metadata:records:groupid',
            'status' => 'privacy:metadata:records:status',
            'timecreated' => 'privacy:metadata:records:timecreated',
        ], 'privacy:metadata:records');
        return $items;
    }

    public static function get_contexts_for_userid(int $userid): contextlist {
        $sql = "SELECT ctx.id
                  FROM {context} ctx
                  JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :contextlevel
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {movidaattendance_records} mar ON mar.attendanceid = cm.instance
                 WHERE mar.userid = :userid";
        $contextlist = new contextlist();
        $contextlist->add_from_sql($sql, [
            'contextlevel' => CONTEXT_MODULE,
            'modname' => 'movidaattendance',
            'userid' => $userid,
        ]);
        return $contextlist;
    }

    public static function get_users_in_context(userlist $userlist): void {
        $context = $userlist->get_context();
        if (!$context instanceof \context_module) {
            return;
        }
        $sql = "SELECT mar.userid
                  FROM {course_modules} cm
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {movidaattendance_records} mar ON mar.attendanceid = cm.instance
                 WHERE cm.id = :cmid";
        $userlist->add_from_sql('userid', $sql, [
            'modname' => 'movidaattendance',
            'cmid' => $context->instanceid,
        ]);
    }

    public static function export_user_data(approved_contextlist $contextlist): void {
        global $DB;

        if (!$contextlist->count()) {
            return;
        }
        $user = $contextlist->get_user();
        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }
            $cm = get_coursemodule_from_id('movidaattendance', $context->instanceid);
            if (!$cm) {
                continue;
            }
            $record = $DB->get_record('movidaattendance_records', [
                'attendanceid' => $cm->instance,
                'userid' => $user->id,
            ]);
            if (!$record) {
                continue;
            }
            $data = helper::get_context_data($context, $user);
            $data->attendance = get_string($record->status, 'mod_movidaattendance');
            $data->timecreated = \core_privacy\local\request\transform::datetime($record->timecreated);
            writer::with_context($context)->export_data([], $data);
            helper::export_context_files($context, $user);
        }
    }

    public static function delete_data_for_all_users_in_context(\context $context): void {
        global $DB;

        if (!$context instanceof \context_module) {
            return;
        }
        $cm = get_coursemodule_from_id('movidaattendance', $context->instanceid);
        if ($cm) {
            $DB->delete_records('movidaattendance_records', ['attendanceid' => $cm->instance]);
        }
    }

    public static function delete_data_for_user(approved_contextlist $contextlist): void {
        global $DB;

        if (!$contextlist->count()) {
            return;
        }
        $userid = $contextlist->get_user()->id;
        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }
            $cm = get_coursemodule_from_id('movidaattendance', $context->instanceid);
            if ($cm) {
                $DB->delete_records('movidaattendance_records', [
                    'attendanceid' => $cm->instance,
                    'userid' => $userid,
                ]);
            }
        }
    }

    public static function delete_data_for_users(approved_userlist $userlist): void {
        global $DB;

        $context = $userlist->get_context();
        if (!$context instanceof \context_module || !$userlist->get_userids()) {
            return;
        }
        $cm = get_coursemodule_from_id('movidaattendance', $context->instanceid);
        if (!$cm) {
            return;
        }
        [$usersql, $params] = $DB->get_in_or_equal($userlist->get_userids(), SQL_PARAMS_NAMED);
        $DB->delete_records_select(
            'movidaattendance_records',
            "attendanceid = :attendanceid AND userid {$usersql}",
            ['attendanceid' => $cm->instance] + $params
        );
    }
}

