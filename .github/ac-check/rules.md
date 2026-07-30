# Review rules

Applied by the finalize agent when verifying findings. A finding suppressed by
a rule is dropped with the rule's ID recorded in the report's `dropped` array.
Rule IDs are the `##` heading texts.

## i18n-labels

User-facing label and copy text is i18n-configurable. A wording difference
from the ticket is not an AC gap unless the ticket explicitly requires exact
copy.
