'use strict';

// Shared, platform-agnostic rules for deciding whether ColdVoice may insert
// text into a focused target. Used by both the Windows (UI Automation) and
// Android (IME / AccessibilityService) layers, and unit-tested in isolation.

// Apps where dictation/overlay must never engage (banking / secure).
const BANKING_BLOCKLIST = [
  'com.android.systemui.keyguard',
  'com.google.android.apps.walletnfcrel',
  'com.paypal.android.p2pmobile',
];

// A node descriptor is intentionally loose so callers from either platform
// can map their native object onto these fields:
//   controlType, isPassword, isEditable, className, inputType,
//   supportsValuePattern, supportsTextPattern, supportsTextEditPattern,
//   acceptsKeyboard, appId, secure
function isPasswordField(node) {
  if (!node) return false;
  if (node.isPassword === true) return true;
  if (node.secure === true) return true;
  const it = String(node.inputType || '').toLowerCase();
  return it.includes('password');
}

function isEditableTarget(node) {
  if (!node) return false;
  const ct = String(node.controlType || '').toLowerCase();
  if (ct === 'edit' || ct === 'document') return true;
  if (node.supportsValuePattern || node.supportsTextPattern || node.supportsTextEditPattern) return true;
  if (node.isEditable === true) return true;
  if (String(node.className || '').toLowerCase().includes('edittext')) return true;
  if (node.acceptsKeyboard === true) return true;
  return false;
}

// The single gate the insertion code should call. Returns true only when it is
// safe to insert text into this target.
function canInsertInto(node) {
  if (!node) return false;
  if (isPasswordField(node)) return false;
  if (node.appId && BANKING_BLOCKLIST.includes(String(node.appId))) return false;
  return isEditableTarget(node);
}

module.exports = { isPasswordField, isEditableTarget, canInsertInto, BANKING_BLOCKLIST };
