# AI Usage

Two AI tools were used during development: Claude (Anthropic) and ChatGPT (OpenAI). Both were accessed through chat conversations, not AI-powered code editors.

## Claude

Claude assisted with application design, implementation, testing, and documentation.

- Designed the application architecture and generated the database schema (`schema.sql`), workflow implementation (`transitions.js`), and workflow tests (`transitions.test.js`). Reported that all seven workflow tests passed.
- Generated the API contract, request validation logic, and validation tests. Created 11 request-validation tests, which passed alongside the seven workflow tests.
- Generated the database connection pool, repository layer, edit-permission rules, and repository integration tests.
- Generated backend request handlers, the Express application, server entry point, and automated handler and HTTP tests.
- Developed the client synchronization engine, report operations, API communication, and retry/backoff logic.
- Created tests for server functionality, client validation, report operations, and synchronization.
- Designed the IndexedDB storage implementation, shared storage contract, and memory storage implementation. Corrected an atomic commit issue in memory storage.
- Developed the automatic synchronization scheduler and application state layer, including their tests.
- Helped diagnose an IndexedDB test failure caused by unhandled `AbortError` rejections and provided a corrected implementation.
- Designed and developed the React frontend, including the report form, report list, report details, coordinator status panel, and activity timeline.
- Implemented frontend styling and integrated the UI components.
- Developed service-worker functionality to support offline app-shell loading.
- Improved automatic and manual synchronization, including synchronization when connectivity returns.
- Fixed bugs discovered during browser testing, including delayed synchronization after reconnecting and stray drafts after invalid or duplicate submissions.
- Ran 13 browser-based scenarios, including offline behavior, and reported that they passed.
- Ran 61 client logic tests in its environment.
- Prepared the frontend update as a ZIP file and provided integration instructions.
- Provided guidance for server setup, database configuration, testing, API documentation, Git commits, and implementation sequencing.

## ChatGPT

ChatGPT assisted with understanding, setup, integration, testing, troubleshooting, and version control.

- Explained the project requirements, technical instructions, and Claude's implementation guidance.
- Guided the development environment setup on Android using Termux, Node.js, npm, and Git.
- Explained Supabase schema creation, test database configuration, SQL execution, and verification.
- Guided the execution of workflow tests and interpretation of their results.
- Reviewed API rules and request-validation behavior.
- Guided the execution of server tests, including the 18 workflow and request-validation tests, and later test suites.
- Guided the setup of the Vite React application while preserving existing client source files.
- Assisted with extracting and integrating generated files into the correct project directories.
- Guided dependency installation, npm configuration, and client test-script setup.
- Helped investigate the IndexedDB test failure and coordinate its correction.
- Guided the execution and verification of client tests, including the final 67 passing client tests.
- Helped test report creation, assignment, status transitions, and the activity timeline.
- Helped troubleshoot the Android/Termux production build issue caused by a missing Lightning CSS binding.
- Helped diagnose the production-preview synchronization issue and identify the CORS configuration problem.
- Guided the update of the server's `CLIENT_URL` to allow the required development and production-preview origins.
- Assisted with testing offline report creation, refreshing while offline, and synchronization after reconnecting.
- Guided manual testing of report validation, assignment, rejection, reopening, and duplicate prevention.
- Guided API and design documentation updates and helped verify them using terminal commands.
- Guided Git staging, meaningful commits, GitHub authentication, repository management, and pushing changes.
- Helped verify successful pushes, a clean working tree, and that private `.env` files were excluded from Git.
- Provided continuity between development sessions through project handovers.

## My Contribution and Verification

I reviewed the generated implementation, made development decisions, integrated the files, ran tests, reported problems, and requested corrections where necessary. I also performed manual testing and managed the Git and GitHub workflow.

I requested that rejection reasons be stored with status changes in one transaction and that report history use an append-only table. I also reviewed the synchronization behavior and requested corrections when testing revealed problems.

I chose not to submit clarification questions and assumptions about their answers. I also rejected Claude's suggestion to use Python instead of JavaScript, keeping JavaScript as the project language.

I ran the automated tests on my Android phone, performed API smoke tests using `curl`, and manually tested the main application workflows, including offline use and synchronization after reconnecting.

I can explain the design decisions above and walk through the code of every module.
