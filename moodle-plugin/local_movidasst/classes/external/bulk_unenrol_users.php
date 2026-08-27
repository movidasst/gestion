<?php
// This file is part of Moodle - http://moodle.org/

namespace local_movidasst\external;

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use course_enrolment_manager;
use invalid_parameter_exception;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/enrol/locallib.php');

/**
 * Remove students from all enrolment methods that Moodle allows an administrator to manage.
 *
 * @package    local_movidasst
 * @copyright  2026 La Movida SST
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class bulk_unenrol_users extends external_api {
    /** Maximum number of users accepted in one web-service call. */
    private const MAX_USERS = 100;

    /**
     * Parameters accepted by execute().
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course ID'),
            'userids' => new external_multiple_structure(
                new external_value(PARAM_INT, 'Moodle user ID'),
                'Users to unenrol'
            ),
        ]);
    }

    /**
     * Unenrol students from every removable enrolment instance in a course.
     *
     * @param int $courseid Moodle course ID.
     * @param int[] $userids Moodle user IDs.
     * @return array
     */
    public static function execute(int $courseid, array $userids): array {
        global $DB, $PAGE;

        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userids' => $userids,
        ]);
        $courseid = (int)$params['courseid'];
        $userids = array_values(array_unique(array_filter(
            array_map('intval', $params['userids']),
            static fn(int $userid): bool => $userid > 0
        )));

        if (count($userids) > self::MAX_USERS) {
            throw new invalid_parameter_exception(
                'A maximum of ' . self::MAX_USERS . ' users is allowed per request.'
            );
        }

        $course = get_course($courseid);
        $context = context_course::instance($courseid);
        self::validate_context($context);
        require_capability('local/movidasst:bulkunenrol', $context);

        $PAGE->set_context($context);
        $manager = new course_enrolment_manager($PAGE, $course);
        $results = [];

        foreach ($userids as $userid) {
            $results[] = self::unenrol_one_user($manager, $context, $courseid, $userid);
        }

        return [
            'requested' => count($userids),
            'unenrolled' => count(array_filter($results,
                static fn(array $result): bool => $result['status'] === 'unenrolled')),
            'partial' => count(array_filter($results,
                static fn(array $result): bool => $result['status'] === 'partial')),
            'unchanged' => count(array_filter($results,
                static fn(array $result): bool => in_array($result['status'], ['unchanged', 'not_enrolled'], true))),
            'protected' => count(array_filter($results,
                static fn(array $result): bool => $result['status'] === 'protected')),
            'errors' => count(array_filter($results,
                static fn(array $result): bool => $result['status'] === 'error')),
            'results' => $results,
        ];
    }

    /**
     * Remove one user's manageable enrolments.
     *
     * @param course_enrolment_manager $manager Course enrolment manager.
     * @param context_course $context Course context.
     * @param int $courseid Course ID.
     * @param int $userid User ID.
     * @return array
     */
    private static function unenrol_one_user(
        course_enrolment_manager $manager,
        context_course $context,
        int $courseid,
        int $userid
    ): array {
        if (is_siteadmin($userid)
                || has_capability('moodle/course:update', $context, $userid)
                || has_capability('moodle/course:manageactivities', $context, $userid)
                || has_capability('moodle/grade:viewall', $context, $userid)) {
            return self::result($userid, 'protected',
                'The user has an administrator or teaching role and was protected.');
        }

        $before = self::get_user_enrolments($courseid, $userid);
        if (!$before) {
            return self::result($userid, 'not_enrolled', 'The user is no longer enrolled in the course.');
        }

        $removedmethods = [];
        $operationerrors = [];
        foreach ($before as $userenrolment) {
            try {
                if ($manager->unenrol_user($userenrolment)) {
                    $removedmethods[] = (string)$userenrolment->enrolmethod;
                } else {
                    $operationerrors[] = (string)$userenrolment->enrolmethod . ': Moodle did not allow unenrolment.';
                }
            } catch (\Throwable $error) {
                $operationerrors[] = (string)$userenrolment->enrolmethod . ': ' . clean_param($error->getMessage(), PARAM_TEXT);
            }
        }

        $remaining = self::get_user_enrolments($courseid, $userid);
        $remainingmethods = array_values(array_unique(array_map(
            static fn(object $record): string => (string)$record->enrolmethod,
            $remaining
        )));
        $removedmethods = array_values(array_unique($removedmethods));

        if (!$remaining) {
            return self::result($userid, 'unenrolled', 'The user was unenrolled successfully.',
                count($before), 0, $removedmethods, []);
        }
        if ($removedmethods) {
            return self::result($userid, 'partial',
                'Some enrolment methods could not be removed: ' . implode(' | ', $operationerrors),
                count($before) - count($remaining), count($remaining), $removedmethods, $remainingmethods);
        }

        return self::result($userid, $operationerrors ? 'error' : 'unchanged',
            $operationerrors ? implode(' | ', $operationerrors) : 'No removable enrolment was found.',
            0, count($remaining), [], $remainingmethods);
    }

    /**
     * Return the enrolment rows for one course and one user.
     *
     * @param int $courseid Course ID.
     * @param int $userid User ID.
     * @return array
     */
    private static function get_user_enrolments(int $courseid, int $userid): array {
        global $DB;

        $sql = "SELECT ue.*, e.enrol AS enrolmethod
                  FROM {user_enrolments} ue
                  JOIN {enrol} e ON e.id = ue.enrolid
                 WHERE e.courseid = :courseid
                   AND ue.userid = :userid
              ORDER BY ue.id";

        return array_values($DB->get_records_sql($sql, [
            'courseid' => $courseid,
            'userid' => $userid,
        ]));
    }

    /**
     * Build a result row.
     *
     * @param int $userid User ID.
     * @param string $status Result status.
     * @param string $message Human-readable result.
     * @param int $removed Number of removed enrolments.
     * @param int $remaining Number of remaining enrolments.
     * @param string[] $removedmethods Removed methods.
     * @param string[] $remainingmethods Remaining methods.
     * @return array
     */
    private static function result(
        int $userid,
        string $status,
        string $message,
        int $removed = 0,
        int $remaining = 0,
        array $removedmethods = [],
        array $remainingmethods = []
    ): array {
        return [
            'userid' => $userid,
            'status' => $status,
            'message' => $message,
            'removed' => $removed,
            'remaining' => $remaining,
            'removedmethods' => $removedmethods,
            'remainingmethods' => $remainingmethods,
        ];
    }

    /**
     * Description of execute() return value.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        $result = new external_single_structure([
            'userid' => new external_value(PARAM_INT, 'Moodle user ID'),
            'status' => new external_value(PARAM_ALPHANUMEXT, 'Result status'),
            'message' => new external_value(PARAM_TEXT, 'Result detail'),
            'removed' => new external_value(PARAM_INT, 'Removed enrolment instances'),
            'remaining' => new external_value(PARAM_INT, 'Remaining enrolment instances'),
            'removedmethods' => new external_multiple_structure(
                new external_value(PARAM_ALPHANUMEXT, 'Removed enrolment method')
            ),
            'remainingmethods' => new external_multiple_structure(
                new external_value(PARAM_ALPHANUMEXT, 'Remaining enrolment method')
            ),
        ]);

        return new external_single_structure([
            'requested' => new external_value(PARAM_INT, 'Requested users'),
            'unenrolled' => new external_value(PARAM_INT, 'Fully unenrolled users'),
            'partial' => new external_value(PARAM_INT, 'Partially unenrolled users'),
            'unchanged' => new external_value(PARAM_INT, 'Users unchanged or already unenrolled'),
            'protected' => new external_value(PARAM_INT, 'Protected users'),
            'errors' => new external_value(PARAM_INT, 'Users with errors'),
            'results' => new external_multiple_structure($result),
        ]);
    }
}
