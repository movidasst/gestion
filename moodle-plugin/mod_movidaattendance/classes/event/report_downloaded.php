<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\event;

defined('MOODLE_INTERNAL') || die();

/** Attendance report downloaded event. */
class report_downloaded extends \core\event\base {
    #[\Override]
    protected function init(): void {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_TEACHING;
        $this->data['objecttable'] = 'movidaattendance';
    }

    #[\Override]
    public static function get_name(): string {
        return get_string('eventreportdownloaded', 'mod_movidaattendance');
    }

    #[\Override]
    public function get_description(): string {
        return "The user with id '{$this->userid}' downloaded the attendance report for course module id "
            . "'{$this->contextinstanceid}'.";
    }

    #[\Override]
    public function get_url(): \moodle_url {
        return new \moodle_url('/mod/movidaattendance/report.php', ['id' => $this->contextinstanceid]);
    }

    public static function get_objectid_mapping(): array {
        return ['db' => 'movidaattendance', 'restore' => 'movidaattendance'];
    }
}

