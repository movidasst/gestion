<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

/** Backup structure for asynchronous attendance. */
class backup_movidaattendance_activity_structure_step extends backup_activity_structure_step {
    protected function define_structure(): backup_nested_element {
        $userinfo = $this->get_setting_value('userinfo');
        $attendance = new backup_nested_element('movidaattendance', ['id'], [
            'name', 'intro', 'introformat', 'timeopen', 'timeclose', 'lateuntil',
            'completioncheckin', 'timemodified',
        ]);
        $records = new backup_nested_element('records');
        $record = new backup_nested_element('record', ['id'], [
            'userid', 'groupid', 'status', 'timecreated',
        ]);

        $attendance->add_child($records);
        $records->add_child($record);
        $attendance->set_source_table('movidaattendance', ['id' => backup::VAR_ACTIVITYID]);
        if ($userinfo) {
            $record->set_source_table('movidaattendance_records', ['attendanceid' => backup::VAR_PARENTID]);
        }
        $record->annotate_ids('user', 'userid');
        $record->annotate_ids('group', 'groupid');
        $attendance->annotate_files('mod_movidaattendance', 'intro', null);
        return $this->prepare_activity_structure($attendance);
    }
}

