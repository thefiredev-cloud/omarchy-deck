/// Preserves the root's existing accessibility visibility while the switcher cover is active.
struct PrivacyCoverAccessibilityState {
    private var previousAccessibilityHidden: Bool?

    mutating func hide(currentAccessibilityHidden: Bool) {
        if previousAccessibilityHidden == nil {
            previousAccessibilityHidden = currentAccessibilityHidden
        }
    }

    mutating func show() -> Bool? {
        defer { previousAccessibilityHidden = nil }
        return previousAccessibilityHidden
    }
}
