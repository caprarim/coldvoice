'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPasswordField, isEditableTarget, canInsertInto } = require('../index');

test('Windows Edit control is editable', () => {
  assert.strictEqual(isEditableTarget({ controlType: 'Edit' }), true);
});

test('node supporting ValuePattern is editable', () => {
  assert.strictEqual(isEditableTarget({ supportsValuePattern: true }), true);
});

test('Android EditText is editable', () => {
  assert.strictEqual(isEditableTarget({ className: 'android.widget.EditText', isEditable: true }), true);
});

test('password field is detected (isPassword)', () => {
  assert.strictEqual(isPasswordField({ controlType: 'Edit', isPassword: true }), true);
});

test('password field is detected (inputType)', () => {
  assert.strictEqual(isPasswordField({ inputType: 'textPassword' }), true);
});

test('never insert into a password field', () => {
  assert.strictEqual(canInsertInto({ controlType: 'Edit', isPassword: true }), false);
});

test('never insert into a blocklisted banking app', () => {
  assert.strictEqual(
    canInsertInto({ controlType: 'Edit', appId: 'com.paypal.android.p2pmobile' }),
    false
  );
});

test('insert allowed for a normal editable field', () => {
  assert.strictEqual(canInsertInto({ controlType: 'Edit' }), true);
});

test('non-editable target is rejected', () => {
  assert.strictEqual(canInsertInto({ controlType: 'Button' }), false);
});
