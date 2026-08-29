<?php
// This file is part of Moodle - http://moodle.org/

require('../../config.php');

$id = required_param('id', PARAM_INT);
require_sesskey();

$cm = get_coursemodule_from_id('movidaattendance', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$attendance = $DB->get_record('movidaattendance', ['id' => $cm->instance], '*', MUST_EXIST);
require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/movidaattendance:checkin', $context);

$record = \mod_movidaattendance\local\attendance_manager::checkin($attendance, $cm, $course, (int)$USER->id);
$message = !$record->wascreated
    ? get_string('alreadyregistered', 'mod_movidaattendance')
    : ($record->status === 'late'
        ? get_string('checkinlate', 'mod_movidaattendance')
        : get_string('checkinsuccess', 'mod_movidaattendance'));
redirect(
    new moodle_url('/mod/movidaattendance/view.php', ['id' => $cm->id]),
    $message,
    null,
    \core\output\notification::NOTIFY_SUCCESS
);

