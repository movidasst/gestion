<?php
// This file is part of Moodle - http://moodle.org/

require('../../config.php');

$id = required_param('id', PARAM_INT);
$cm = get_coursemodule_from_id('movidaattendance', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$attendance = $DB->get_record('movidaattendance', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/movidaattendance:view', $context);

$PAGE->set_url('/mod/movidaattendance/view.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($attendance->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

$event = \mod_movidaattendance\event\course_module_viewed::create([
    'objectid' => $attendance->id,
    'context' => $context,
]);
$event->add_record_snapshot('course', $course);
$event->add_record_snapshot('course_modules', $cm);
$event->add_record_snapshot('movidaattendance', $attendance);
$event->trigger();

$completion = new completion_info($course);
$completion->set_module_viewed($cm);

$record = $DB->get_record('movidaattendance_records', [
    'attendanceid' => $attendance->id,
    'userid' => $USER->id,
]);
$window = \mod_movidaattendance\local\attendance_manager::window_state($attendance);

echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($attendance->name));
if (trim($attendance->intro)) {
    echo $OUTPUT->box(format_module_intro('movidaattendance', $attendance, $cm->id), 'generalbox mod_introbox');
}

$badgeclass = 'movidaattendance-badge';
if ($window === 'late') {
    $badgeclass .= ' is-late';
} else if ($window === 'closed') {
    $badgeclass .= ' is-closed';
}
$windowlabel = match ($window) {
    'before_open' => get_string('notopenyet', 'mod_movidaattendance'),
    'late' => get_string('latewindow', 'mod_movidaattendance'),
    'closed' => get_string('closed', 'mod_movidaattendance'),
    default => get_string('open', 'mod_movidaattendance'),
};

$content = html_writer::tag('div', s($windowlabel), ['class' => $badgeclass]);
$windowlines = [];
if ($attendance->timeopen) {
    $windowlines[] = get_string('opensat', 'mod_movidaattendance', userdate($attendance->timeopen));
}
if ($attendance->timeclose) {
    $windowlines[] = get_string('closesat', 'mod_movidaattendance', userdate($attendance->timeclose));
} else {
    $windowlines[] = get_string('alwaysopen', 'mod_movidaattendance');
}
if ($attendance->lateuntil) {
    $windowlines[] = get_string('lateclosesat', 'mod_movidaattendance', userdate($attendance->lateuntil));
}
$content .= html_writer::tag('p', s(implode(' · ', $windowlines)), ['class' => 'movidaattendance-window']);

if ($record) {
    $status = get_string($record->status, 'mod_movidaattendance');
    $message = get_string('alreadyregistered', 'mod_movidaattendance') . ' '
        . get_string('recordedat', 'mod_movidaattendance', userdate($record->timecreated)) . ' · ' . $status;
    $content .= html_writer::tag('p', s($message), ['class' => 'movidaattendance-confirmation']);
} else if (has_capability('mod/movidaattendance:checkin', $context)
        && in_array($window, ['open', 'late'], true)) {
    $form = html_writer::start_tag('form', [
        'method' => 'post',
        'action' => new moodle_url('/mod/movidaattendance/checkin.php'),
    ]);
    $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'id', 'value' => $cm->id]);
    $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    $form .= html_writer::tag('button', get_string('registerattendance', 'mod_movidaattendance'), [
        'type' => 'submit',
        'class' => 'movidaattendance-button',
    ]);
    $form .= html_writer::end_tag('form');
    $content .= $form;
}

if (has_capability('mod/movidaattendance:viewreports', $context)) {
    $content .= html_writer::div(
        html_writer::link(
            new moodle_url('/mod/movidaattendance/report.php', ['id' => $cm->id]),
            get_string('viewreport', 'mod_movidaattendance'),
            ['class' => 'btn btn-secondary mt-4']
        )
    );
}
echo html_writer::tag('section', $content, ['class' => 'movidaattendance-card']);
echo $OUTPUT->footer();

