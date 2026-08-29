<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\event;

defined('MOODLE_INTERNAL') || die();

/** Event fired when a student records attendance. */
class checkin_created extends \core\event\base {
    public static function create_from_record(
        \stdClass $record,
        \stdClass $attendance,
        \stdClass $cm,
        \stdClass $course
    ): self {
        $event = self::create([
            'objectid' => $record->id,
            'context' => \context_module::instance($cm->id),
            'courseid' => $course->id,
            'userid' => $record->userid,
            'relateduserid' => $record->userid,
            'other' => [
                'attendanceid' => $attendance->id,
                'status' => $record->status,
            ],
        ]);
        $event->add_record_snapshot('course', $course);
        $event->add_record_snapshot('course_modules', $cm);
        $event->add_record_snapshot('movidaattendance', $attendance);
        $event->add_record_snapshot('movidaattendance_records', $record);
        return $event;
    }

    #[\Override]
    protected function init(): void {
        $this->data['crud'] = 'c';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
        $this->data['objecttable'] = 'movidaattendance_records';
    }

    #[\Override]
    public static function get_name(): string {
        return get_string('eventcheckincreated', 'mod_movidaattendance');
    }

    #[\Override]
    public function get_description(): string {
        return "The user with id '{$this->userid}' recorded attendance with status '"
            . $this->other['status'] . "' in the activity with course module id '{$this->contextinstanceid}'.";
    }

    #[\Override]
    public function get_url(): \moodle_url {
        return new \moodle_url('/mod/movidaattendance/view.php', ['id' => $this->contextinstanceid]);
    }

    #[\Override]
    protected function validate_data(): void {
        parent::validate_data();
        if (!isset($this->other['attendanceid'], $this->other['status'])) {
            throw new \coding_exception('Attendance id and status are required.');
        }
    }

    public static function get_objectid_mapping(): array {
        return ['db' => 'movidaattendance_records', 'restore' => 'attendance_record'];
    }

    public static function get_other_mapping(): array {
        return [
            'attendanceid' => ['db' => 'movidaattendance', 'restore' => 'movidaattendance'],
            'status' => self::NOT_MAPPED,
        ];
    }
}

