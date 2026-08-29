<?php
// This file is part of Moodle - http://moodle.org/

declare(strict_types=1);

namespace mod_movidaattendance\completion;

use core_completion\activity_custom_completion;

/** Custom completion rule for attendance check-in. */
class custom_completion extends activity_custom_completion {
    #[\Override]
    public function get_state(string $rule): int {
        global $DB;

        $this->validate_rule($rule);
        $exists = $DB->record_exists('movidaattendance_records', [
            'attendanceid' => $this->cm->instance,
            'userid' => $this->userid,
        ]);
        return $exists ? COMPLETION_COMPLETE : COMPLETION_INCOMPLETE;
    }

    #[\Override]
    public static function get_defined_custom_rules(): array {
        return ['completioncheckin'];
    }

    #[\Override]
    public function get_custom_rule_descriptions(): array {
        return ['completioncheckin' => get_string('completiondetail:checkin', 'mod_movidaattendance')];
    }

    #[\Override]
    public function get_sort_order(): array {
        return ['completionview', 'completioncheckin'];
    }
}

