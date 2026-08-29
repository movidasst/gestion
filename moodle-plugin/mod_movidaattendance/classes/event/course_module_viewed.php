<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\event;

defined('MOODLE_INTERNAL') || die();

/** Attendance activity viewed event. */
class course_module_viewed extends \core\event\course_module_viewed {
    #[\Override]
    protected function init(): void {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
        $this->data['objecttable'] = 'movidaattendance';
    }

    public static function get_objectid_mapping(): array {
        return ['db' => 'movidaattendance', 'restore' => 'movidaattendance'];
    }
}

