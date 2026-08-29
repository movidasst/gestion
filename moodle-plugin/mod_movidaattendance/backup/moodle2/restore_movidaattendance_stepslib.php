<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

/** Restore structure for asynchronous attendance. */
class restore_movidaattendance_activity_structure_step extends restore_activity_structure_step {
    protected function define_structure(): array {
        $paths = [new restore_path_element('movidaattendance', '/activity/movidaattendance')];
        if ($this->get_setting_value('userinfo')) {
            $paths[] = new restore_path_element(
                'attendance_record',
                '/activity/movidaattendance/records/record'
            );
        }
        return $this->prepare_activity_structure($paths);
    }

    protected function process_movidaattendance($data): void {
        global $DB;

        $data = (object)$data;
        $data->course = $this->get_courseid();
        $data->timeopen = $data->timeopen ? $this->apply_date_offset($data->timeopen) : 0;
        $data->timeclose = $data->timeclose ? $this->apply_date_offset($data->timeclose) : 0;
        $data->lateuntil = $data->lateuntil ? $this->apply_date_offset($data->lateuntil) : 0;
        $newid = $DB->insert_record('movidaattendance', $data);
        $this->apply_activity_instance($newid);
    }

    protected function process_attendance_record($data): void {
        global $DB;

        $data = (object)$data;
        $data->attendanceid = $this->get_new_parentid('movidaattendance');
        $data->userid = $this->get_mappingid('user', $data->userid);
        $data->groupid = $data->groupid ? $this->get_mappingid('group', $data->groupid, 0) : 0;
        if (!$data->userid) {
            return;
        }
        $newid = $DB->insert_record('movidaattendance_records', $data);
        $this->set_mapping('attendance_record', $data->id, $newid);
    }

    protected function after_execute(): void {
        $this->add_related_files('mod_movidaattendance', 'intro', null);
    }
}

