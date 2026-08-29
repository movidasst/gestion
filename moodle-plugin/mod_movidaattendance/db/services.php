<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

$functions = [
    'mod_movidaattendance_get_course_report' => [
        'classname' => 'mod_movidaattendance\\external\\get_course_report',
        'description' => 'Returns asynchronous attendance metrics for a course, optionally filtered by group.',
        'type' => 'read',
        'ajax' => true,
        'capabilities' => 'moodle/course:viewparticipants,mod/movidaattendance:viewreports',
    ],
];

