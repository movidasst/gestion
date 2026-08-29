<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/movidaattendance/backup/moodle2/backup_movidaattendance_stepslib.php');

/** Backup task for asynchronous attendance. */
class backup_movidaattendance_activity_task extends backup_activity_task {
    protected function define_my_settings(): void {
    }

    protected function define_my_steps(): void {
        $this->add_step(new backup_movidaattendance_activity_structure_step(
            'movidaattendance_structure',
            'movidaattendance.xml'
        ));
    }

    public static function encode_content_links($content): string {
        global $CFG;

        $base = preg_quote($CFG->wwwroot, '/');
        $content = preg_replace(
            '/(' . $base . '\/mod\/movidaattendance\/index.php\?id=)([0-9]+)/',
            '$@MOVIDAATTENDANCEINDEX*$2@$',
            $content
        );
        return preg_replace(
            '/(' . $base . '\/mod\/movidaattendance\/view.php\?id=)([0-9]+)/',
            '$@MOVIDAATTENDANCEVIEWBYID*$2@$',
            $content
        );
    }
}

