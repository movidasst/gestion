<?php
// This file is part of Moodle - http://moodle.org/

require('../../config.php');

$id = required_param('id', PARAM_INT);
$course = get_course($id);
require_course_login($course);

$PAGE->set_url('/mod/movidaattendance/index.php', ['id' => $course->id]);
$PAGE->set_title(get_string('modulenameplural', 'mod_movidaattendance'));
$PAGE->set_heading(format_string($course->fullname));

$modinfo = get_fast_modinfo($course);
$cms = $modinfo->get_instances_of('movidaattendance');

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('modulenameplural', 'mod_movidaattendance'));
if (!$cms) {
    echo $OUTPUT->notification(get_string('noattendances', 'mod_movidaattendance'), 'info');
} else {
    $table = new html_table();
    $table->head = [get_string('name'), get_string('status', 'mod_movidaattendance')];
    foreach ($cms as $cm) {
        if (!$cm->uservisible) {
            continue;
        }
        $attendance = $DB->get_record('movidaattendance', ['id' => $cm->instance], '*', MUST_EXIST);
        $state = \mod_movidaattendance\local\attendance_manager::window_state($attendance);
        $label = match ($state) {
            'before_open' => get_string('upcoming', 'mod_movidaattendance'),
            'late' => get_string('latewindow', 'mod_movidaattendance'),
            'closed' => get_string('closed', 'mod_movidaattendance'),
            default => get_string('open', 'mod_movidaattendance'),
        };
        $table->data[] = [
            html_writer::link(new moodle_url('/mod/movidaattendance/view.php', ['id' => $cm->id]), format_string($cm->name)),
            $label,
        ];
    }
    echo html_writer::table($table);
}
echo $OUTPUT->footer();

