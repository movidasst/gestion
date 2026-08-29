<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

/**
 * Add an attendance checkpoint.
 *
 * @param stdClass $data
 * @return int
 */
function movidaattendance_add_instance(stdClass $data): int {
    global $DB;

    $data->timemodified = time();
    return $DB->insert_record('movidaattendance', $data);
}

/**
 * Update an attendance checkpoint.
 *
 * @param stdClass $data
 * @return bool
 */
function movidaattendance_update_instance(stdClass $data): bool {
    global $DB;

    $data->id = $data->instance;
    $data->timemodified = time();
    return $DB->update_record('movidaattendance', $data);
}

/**
 * Delete an attendance checkpoint and its records.
 *
 * @param int $id
 * @return bool
 */
function movidaattendance_delete_instance(int $id): bool {
    global $DB;

    if (!$attendance = $DB->get_record('movidaattendance', ['id' => $id])) {
        return false;
    }
    $DB->delete_records('movidaattendance_records', ['attendanceid' => $attendance->id]);
    $DB->delete_records('movidaattendance', ['id' => $attendance->id]);
    return true;
}

/**
 * Module feature support.
 *
 * @param string $feature
 * @return bool|string|null
 */
function movidaattendance_supports(string $feature): bool|string|null {
    return match ($feature) {
        FEATURE_GROUPS => true,
        FEATURE_GROUPINGS => true,
        FEATURE_MOD_INTRO => true,
        FEATURE_SHOW_DESCRIPTION => true,
        FEATURE_COMPLETION_TRACKS_VIEWS => true,
        FEATURE_COMPLETION_HAS_RULES => true,
        FEATURE_BACKUP_MOODLE2 => true,
        FEATURE_MOD_PURPOSE => MOD_PURPOSE_COMMUNICATION,
        default => null,
    };
}

/**
 * Add cached information used by course pages and completion.
 *
 * @param stdClass $coursemodule
 * @return cached_cm_info|false
 */
function movidaattendance_get_coursemodule_info(stdClass $coursemodule): cached_cm_info|false {
    global $DB;

    $fields = 'id,name,intro,introformat,timeopen,timeclose,lateuntil,completioncheckin';
    $attendance = $DB->get_record('movidaattendance', ['id' => $coursemodule->instance], $fields);
    if (!$attendance) {
        return false;
    }

    $result = new cached_cm_info();
    $result->name = $attendance->name;
    if ($coursemodule->showdescription) {
        $result->content = format_module_intro('movidaattendance', $attendance, $coursemodule->id, false);
    }
    if ($coursemodule->completion == COMPLETION_TRACKING_AUTOMATIC) {
        $result->customdata['customcompletionrules']['completioncheckin'] = $attendance->completioncheckin;
    }
    $result->customdata['timeopen'] = $attendance->timeopen;
    $result->customdata['timeclose'] = $attendance->timeclose;
    $result->customdata['lateuntil'] = $attendance->lateuntil;
    return $result;
}

/**
 * Describe the active custom completion rule.
 *
 * @param cm_info|stdClass $cm
 * @return array
 */
function mod_movidaattendance_get_completion_active_rule_descriptions($cm): array {
    if ($cm->completion != COMPLETION_TRACKING_AUTOMATIC
            || empty($cm->customdata['customcompletionrules']['completioncheckin'])) {
        return [];
    }
    return [get_string('completioncheckin', 'mod_movidaattendance')];
}

/**
 * Add a report link to activity navigation.
 *
 * @param settings_navigation $settings
 * @param navigation_node $node
 */
function movidaattendance_extend_settings_navigation(settings_navigation $settings, navigation_node $node): void {
    $context = $settings->get_page()->cm->context;
    if (has_capability('mod/movidaattendance:viewreports', $context)) {
        $node->add(
            get_string('reports', 'mod_movidaattendance'),
            new moodle_url('/mod/movidaattendance/report.php', ['id' => $settings->get_page()->cm->id])
        );
    }
}

/**
 * Return a short user activity summary.
 *
 * @param stdClass $course
 * @param stdClass $user
 * @param stdClass $mod
 * @param stdClass $attendance
 * @return stdClass|null
 */
function movidaattendance_user_outline($course, $user, $mod, $attendance): ?stdClass {
    global $DB;

    $record = $DB->get_record('movidaattendance_records', [
        'attendanceid' => $attendance->id,
        'userid' => $user->id,
    ]);
    if (!$record) {
        return null;
    }
    return (object)[
        'info' => get_string($record->status, 'mod_movidaattendance'),
        'time' => $record->timecreated,
    ];
}

/**
 * Print complete user activity information.
 *
 * @param stdClass $course
 * @param stdClass $user
 * @param stdClass $mod
 * @param stdClass $attendance
 */
function movidaattendance_user_complete($course, $user, $mod, $attendance): void {
    $outline = movidaattendance_user_outline($course, $user, $mod, $attendance);
    if (!$outline) {
        echo get_string('unregistered', 'mod_movidaattendance');
        return;
    }
    echo s($outline->info) . ' · ' . userdate($outline->time);
}

/** Add attendance cleanup to the course reset form. */
function movidaattendance_reset_course_form_definition(&$mform): void {
    $mform->addElement(
        'advcheckbox',
        'reset_movidaattendance',
        get_string('modulenameplural', 'mod_movidaattendance'),
        get_string('resetattendance', 'mod_movidaattendance')
    );
}

/** Remove attendance records when requested through course reset. */
function movidaattendance_reset_userdata(stdClass $data): array {
    global $DB;

    if (empty($data->reset_movidaattendance)) {
        return [];
    }
    $instances = $DB->get_records('movidaattendance', ['course' => $data->courseid], '', 'id');
    if ($instances) {
        $DB->delete_records_list('movidaattendance_records', 'attendanceid', array_keys($instances));
    }
    return [[
        'component' => get_string('modulenameplural', 'mod_movidaattendance'),
        'item' => get_string('resetattendance', 'mod_movidaattendance'),
        'error' => false,
    ]];
}
