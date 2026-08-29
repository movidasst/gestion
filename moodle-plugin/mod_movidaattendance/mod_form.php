<?php
// This file is part of Moodle - http://moodle.org/

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');

/** Activity settings form. */
class mod_movidaattendance_mod_form extends moodleform_mod {
    #[\Override]
    public function definition(): void {
        $mform = $this->_form;

        $mform->addElement('header', 'general', get_string('general', 'form'));
        $mform->addElement('text', 'name', get_string('movidaattendancename', 'mod_movidaattendance'), ['size' => 64]);
        $mform->setType('name', PARAM_CLEANHTML);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 1333), 'maxlength', 1333, 'client');
        $mform->addHelpButton('name', 'movidaattendancename', 'mod_movidaattendance');

        $this->standard_intro_elements();

        $mform->addElement('header', 'availabilityhdr', get_string('availability', 'mod_movidaattendance'));
        $mform->addElement('date_time_selector', 'timeopen', get_string('timeopen', 'mod_movidaattendance'), [
            'optional' => true,
        ]);
        $mform->addElement('date_time_selector', 'timeclose', get_string('timeclose', 'mod_movidaattendance'), [
            'optional' => true,
        ]);
        $mform->addElement('date_time_selector', 'lateuntil', get_string('lateuntil', 'mod_movidaattendance'), [
            'optional' => true,
        ]);
        $mform->addHelpButton('lateuntil', 'lateuntil', 'mod_movidaattendance');

        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    #[\Override]
    public function validation($data, $files): array {
        $errors = parent::validation($data, $files);
        $open = (int)($data['timeopen'] ?? 0);
        $close = (int)($data['timeclose'] ?? 0);
        $late = (int)($data['lateuntil'] ?? 0);

        if (($open && $close && $close < $open)
                || ($late && !$close)
                || ($close && $late && $late < $close)) {
            $errors['lateuntil'] = get_string('invalidwindow', 'mod_movidaattendance');
        }
        return $errors;
    }

    #[\Override]
    public function add_completion_rules(): array {
        $mform = $this->_form;
        $element = 'completioncheckin' . $this->get_suffix();
        $mform->addElement('checkbox', $element, '', get_string('completioncheckin', 'mod_movidaattendance'));
        $mform->setDefault($element, 1);
        return [$element];
    }

    #[\Override]
    public function completion_rule_enabled($data): bool {
        return !empty($data['completioncheckin' . $this->get_suffix()]);
    }

    #[\Override]
    public function data_postprocessing($data): void {
        parent::data_postprocessing($data);
        if (!empty($data->completionunlocked)) {
            $property = 'completioncheckin' . $this->get_suffix();
            if (empty($data->{$property})) {
                $data->{$property} = 0;
            }
        }
    }
}

