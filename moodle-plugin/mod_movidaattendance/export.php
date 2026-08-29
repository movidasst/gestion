<?php
// This file is part of Moodle - http://moodle.org/

require('../../config.php');
require_once($CFG->libdir . '/csvlib.class.php');

$id = required_param('id', PARAM_INT);
$groupid = optional_param('group', 0, PARAM_INT);
require_sesskey();

$cm = get_coursemodule_from_id('movidaattendance', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$attendance = $DB->get_record('movidaattendance', ['id' => $cm->instance], '*', MUST_EXIST);
require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/movidaattendance:downloadreports', $context);
$groupid = groups_get_activity_group($cm, true);

$report = \mod_movidaattendance\local\report_builder::get_instance_report($attendance, $cm, $groupid);
$event = \mod_movidaattendance\event\report_downloaded::create([
    'objectid' => $attendance->id,
    'context' => $context,
]);
$event->trigger();

$filename = clean_filename(format_string($course->shortname) . '-' . format_string($attendance->name));
$csv = new csv_export_writer();
$csv->set_filename($filename);
$csv->add_data([
    get_string('participant', 'mod_movidaattendance'),
    get_string('idnumber', 'mod_movidaattendance'),
    get_string('email', 'mod_movidaattendance'),
    get_string('group', 'mod_movidaattendance'),
    get_string('status', 'mod_movidaattendance'),
    get_string('checkintime', 'mod_movidaattendance'),
]);
foreach ($report['rows'] as $row) {
    $csv->add_data([
        $row['fullname'],
        $row['idnumber'],
        $row['email'],
        $row['groupname'],
        get_string($row['status'], 'mod_movidaattendance'),
        $row['timecreated'] ? userdate($row['timecreated']) : '',
    ]);
}
$csv->download_file();
exit;
