Review the code changes for quality and Nostr best practices.

Diff to review: ${{ git diff }}

Analyze the changes for:

## 1. Nostr Protocol Compliance
- Correct event kinds used for the feature
- Proper tag structures (NIP-10 threading, NIP-19 identifiers, etc.)
- Appropriate handling of replaceable vs regular events

## 2. Applesauce Patterns
- Using EventStore singleton (not creating new instances)
- NOT wrapping applesauce helpers in useMemo (they cache internally)
- Proper subscription cleanup in useEffect
- Using reactive patterns (observables) correctly

## 3. React Best Practices
- No missing dependencies in useEffect/useMemo/useCallback
- Proper cleanup functions in useEffect
- No unnecessary re-renders or state updates

## 4. Code Quality
- Follows existing patterns in the codebase
- No over-engineering or unnecessary abstractions
- Security considerations (XSS prevention, input validation)
- Proper error handling where needed

## 5. Architecture Alignment
- Uses path alias (@/) correctly
- Follows file organization conventions
- State mutations go through logic.ts pure functions

Provide specific, actionable feedback with `file:line` references.
