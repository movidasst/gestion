<?php
// This file is part of Moodle - http://moodle.org/

namespace local_movidasst\privacy;

defined('MOODLE_INTERNAL') || die();

/**
 * Privacy provider for the Movida SST local integration.
 *
 * @package    local_movidasst
 * @copyright  2026 La Movida SST
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class provider implements \core_privacy\local\metadata\null_provider {
    /**
     * Explain why this plugin stores no personal data.
     *
     * @return string
     */
    public static function get_reason(): string {
        return 'privacy:metadata';
    }
}
