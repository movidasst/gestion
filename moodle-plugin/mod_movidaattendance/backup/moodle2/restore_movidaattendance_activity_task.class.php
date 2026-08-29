<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/movidaattendance/backup/moodle2/restore_movidaattendance_stepslib.php');

/** Restore task for asynchronous attendance. */
class restore_movidaattendance_activity_task extends restore_activity_task {
    protected function define_my_settings(): void {
    }

    protected function define_my_steps(): void {
        $this->add_step(new restore_movidaattendance_activity_structure_step(
            'movidaattendance_structure',
            'movidaattendance.xml'
        ));
    }

    public static function define_decode_contents(): array {
        return [new restore_decode_content('movidaattendance', ['intro'], 'movidaattendance')];
    }

    public static function define_decode_rules(): array {
        return [
            new restore_decode_rule('MOVIDAATTENDANCEVIEWBYID', '/mod/movidaattendance/view.php?id=$1', 'course_module'),
            new restore_decode_rule('MOVIDAATTENDANCEINDEX', '/mod/movidaattendance/index.php?id=$1', 'course'),
        ];
    }

    public static function define_restore_log_rules(): array {
        return [];
    }

    public static function define_restore_log_rules_for_course(): array {
        return [];
    }
}

