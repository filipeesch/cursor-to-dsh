# Tasks

## 1. Count calls per run

- [x] 1.1 Track the number of model calls the current provider run has served on the session, resetting it when a new run starts; verify a test asserts the count for a run that serves several calls.
- [x] 1.2 Increment the count once per host call, including the call that receives the report; verify the count equals the number of calls the run served.

## 2. Normalize the report

- [x] 2.1 Divide every bucket of a provider report by the run's call count before it reaches the host, rounding and never emitting a negative value; verify unit tests for the divisor including a divisor of one.
- [x] 2.2 Keep the report on the call where it arrives and leave the earlier calls of the run without usage; verify a fake-agent test for a multi-call run.

## 3. Documentation

- [x] 3.1 Update the README limitation to explain that usage is run-scoped and reported as the run's average request, including the totals trade-off; verify the wording matches the implementation.

## 4. Release

- [x] 4.1 Run `npm run prepublishOnly`; verify check, tests, build and the public check pass.
- [x] 4.2 Bump the package version to `0.3.1`; verify `package.json` and that the gate passes after the bump.
