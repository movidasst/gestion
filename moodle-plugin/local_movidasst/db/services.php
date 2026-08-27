<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_movidasst_bulk_unenrol_users' => [
        'classname' => 'local_movidasst\\external\\bulk_unenrol_users',
        'description' => 'Safely unenrols students from every removable enrolment method in a course.',
        'type' => 'write',
        'ajax' => true,
        'capabilities' => 'local/movidasst:bulkunenrol',
    ],
];
