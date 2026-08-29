<?php
// This file is part of Moodle - http://moodle.org/

require('../../config.php');

$id = required_param('id', PARAM_INT);
$cm = get_coursemodule_from_id('movidaattendance', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$attendance = $DB->get_record('movidaattendance', ['id' => $cm->instance], '*', MUST_EXIST);
require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/movidaattendance:viewreports', $context);

$url = new moodle_url('/mod/movidaattendance/report.php', ['id' => $cm->id]);
$PAGE->set_url($url);
$PAGE->set_title(get_string('reports', 'mod_movidaattendance'));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

$groupid = groups_get_activity_group($cm, true);
$report = \mod_movidaattendance\local\report_builder::get_instance_report($attendance, $cm, $groupid);

$event = \mod_movidaattendance\event\report_viewed::create([
    'objectid' => $attendance->id,
    'context' => $context,
]);
$event->trigger();

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('reports', 'mod_movidaattendance') . ': ' . format_string($attendance->name));
groups_print_activity_menu($cm, $url);

$summary = $report['summary'];
$stats = '';
foreach ([
    'participants' => $summary['participants'],
    'registered' => $summary['registered'],
    'present' => $summary['present'],
    'late' => $summary['late'],
] as $label => $value) {
    $stats .= html_writer::div(
        html_writer::tag('strong', (string)$value) . html_writer::tag('span', get_string($label, 'mod_movidaattendance')),
        'movidaattendance-stat'
    );
}
echo html_writer::div($stats, 'movidaattendance-stats');

if (has_capability('mod/movidaattendance:downloadreports', $context)) {
    echo html_writer::div(html_writer::link(
        new moodle_url('/mod/movidaattendance/export.php', ['id' => $cm->id, 'group' => $groupid, 'sesskey' => sesskey()]),
        get_string('downloadcsv', 'mod_movidaattendance'),
        ['class' => 'btn btn-secondary mb-3']
    ));
}

if (!$report['rows']) {
    echo $OUTPUT->notification(get_string('nousers', 'mod_movidaattendance'), 'info');
} else {
    $table = new html_table();
    $table->head = [
        get_string('participant', 'mod_movidaattendance'),
        get_string('idnumber', 'mod_movidaattendance'),
        get_string('email', 'mod_movidaattendance'),
        get_string('group', 'mod_movidaattendance'),
        get_string('status', 'mod_movidaattendance'),
        get_string('checkintime', 'mod_movidaattendance'),
    ];
    foreach ($report['rows'] as $row) {
        $table->data[] = [
            s($row['fullname']),
            s($row['idnumber']),
            s($row['email']),
            s($row['groupname']),
            get_string($row['status'], 'mod_movidaattendance'),
            $row['timecreated'] ? userdate($row['timecreated']) : '—',
        ];
    }
    echo html_writer::table($table);
}
echo $OUTPUT->footer();

