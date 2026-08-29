<?php
// This file is part of Moodle - http://moodle.org/

namespace mod_movidaattendance\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use mod_movidaattendance\local\report_builder;

defined('MOODLE_INTERNAL') || die();

/** External course attendance report used by Gestión. */
class get_course_report extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Moodle course ID'),
            'groupid' => new external_value(PARAM_INT, 'Optional Moodle group ID', VALUE_DEFAULT, 0),
        ]);
    }

    public static function execute(int $courseid, int $groupid = 0): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'groupid' => $groupid,
        ]);
        $context = \context_course::instance($params['courseid']);
        self::validate_context($context);
        require_capability('moodle/course:viewparticipants', $context);
        return report_builder::get_course_report((int)$params['courseid'], (int)$params['groupid']);
    }

    public static function execute_returns(): external_single_structure {
        $summary = new external_single_structure([
            'activities' => new external_value(PARAM_INT, 'Attendance activities'),
            'participants' => new external_value(PARAM_INT, 'Distinct participants'),
            'expected' => new external_value(PARAM_INT, 'Check-ins expected so far'),
            'registered' => new external_value(PARAM_INT, 'Recorded check-ins'),
            'present' => new external_value(PARAM_INT, 'On-time check-ins'),
            'late' => new external_value(PARAM_INT, 'Late check-ins'),
            'missed' => new external_value(PARAM_INT, 'Closed checkpoints without check-in'),
            'pending' => new external_value(PARAM_INT, 'Open checkpoints without check-in'),
            'upcoming' => new external_value(PARAM_INT, 'Future checkpoints'),
            'averagepercentage' => new external_value(PARAM_FLOAT, 'Average attendance percentage'),
            'lastcheckin' => new external_value(PARAM_INT, 'Latest check-in timestamp'),
        ]);
        $activity = new external_single_structure([
            'id' => new external_value(PARAM_INT, 'Attendance instance ID'),
            'cmid' => new external_value(PARAM_INT, 'Course module ID'),
            'name' => new external_value(PARAM_TEXT, 'Checkpoint name'),
            'timeopen' => new external_value(PARAM_INT, 'Opening timestamp'),
            'timeclose' => new external_value(PARAM_INT, 'On-time closing timestamp'),
            'lateuntil' => new external_value(PARAM_INT, 'Late closing timestamp'),
            'windowstate' => new external_value(PARAM_ALPHANUMEXT, 'Current window state'),
            'participants' => new external_value(PARAM_INT, 'Participants'),
            'expected' => new external_value(PARAM_INT, 'Expected check-ins'),
            'registered' => new external_value(PARAM_INT, 'Recorded check-ins'),
            'present' => new external_value(PARAM_INT, 'On-time check-ins'),
            'late' => new external_value(PARAM_INT, 'Late check-ins'),
            'missed' => new external_value(PARAM_INT, 'Missed check-ins'),
            'pending' => new external_value(PARAM_INT, 'Pending check-ins'),
            'upcoming' => new external_value(PARAM_INT, 'Future check-ins'),
        ]);
        $user = new external_single_structure([
            'userid' => new external_value(PARAM_INT, 'Moodle user ID'),
            'fullname' => new external_value(PARAM_TEXT, 'Full name'),
            'email' => new external_value(PARAM_EMAIL, 'Email address'),
            'idnumber' => new external_value(PARAM_TEXT, 'ID number'),
            'scheduled' => new external_value(PARAM_INT, 'Scheduled checkpoints'),
            'expected' => new external_value(PARAM_INT, 'Expected checkpoints so far'),
            'registered' => new external_value(PARAM_INT, 'Recorded check-ins'),
            'present' => new external_value(PARAM_INT, 'On-time check-ins'),
            'late' => new external_value(PARAM_INT, 'Late check-ins'),
            'missed' => new external_value(PARAM_INT, 'Missed check-ins'),
            'pending' => new external_value(PARAM_INT, 'Pending check-ins'),
            'upcoming' => new external_value(PARAM_INT, 'Upcoming check-ins'),
            'hasdue' => new external_value(PARAM_BOOL, 'Whether the user has due checkpoints'),
            'percentage' => new external_value(PARAM_FLOAT, 'Attendance percentage'),
            'lastcheckin' => new external_value(PARAM_INT, 'Latest check-in timestamp'),
        ]);
        return new external_single_structure([
            'courseid' => new external_value(PARAM_INT, 'Moodle course ID'),
            'coursefullname' => new external_value(PARAM_TEXT, 'Course full name'),
            'groupid' => new external_value(PARAM_INT, 'Moodle group ID'),
            'generatedat' => new external_value(PARAM_INT, 'Report generation timestamp'),
            'summary' => $summary,
            'activities' => new external_multiple_structure($activity),
            'users' => new external_multiple_structure($user),
        ]);
    }
}

