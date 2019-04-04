<p align="center">
  <img src="https://images.atomist.com/sdm/SDM-Logo-Dark.png">
</p>

# @atomist/sdm-pack-s3

[![atomist sdm goals](https://badge.atomist.com/T29E48P34/atomist/sdm-pack-s3/728dec9b-f3d3-4363-a09c-a0a017f2074c)](https://app.atomist.com/workspace/T29E48P34)
[![npm version](https://img.shields.io/npm/v/@atomist/sdm-pack-s3.svg)](https://www.npmjs.com/package/@atomist/sdm-pack-s3)

An extension pack for an [Atomist][atomist]
software delivery machine (SDM). See the
[Atomist documentation][atomist-doc] for more information on the
concept of a software delivery machine and how to create and develop
an SDM.

Send your project's build output to S3 using the `publishToS3` goal.

[atomist-doc]: https://docs.atomist.com/ (Atomist Documentation)

## Using

In your software delivery machine project:

`npm install @atomist/sdm-pack-s3`

then in your `machine.ts`:

```typescript
import { publishToS3Goal } from "@atomist/sdm-pack-s3";

    const publish = publishToS3Goal({
        bucketName: "your-bucket-name",
        region: "us-west-2", // use your region
        filesToPublish: ["site/**/*.html", "more/files/to/publish"],
        pathTranslation: (filepath, inv) => filepath, // rearrange files if necessary
        pathToIndex: "site/index.html", // index file in your project
    });
```

If you need a build to happen before the publish, call `withProjectListener()` on that goal
and pass a [GoalProjectListenerRegistration](https://docs.atomist.com/developer/goals-more/#prepare-the-checked-out-code).

Add this publish goal to one of your goal sets.

```typescript
    const publishGoals = goals("publish static site to S3")
        .plan(publish);

    sdm.withPushRules(
        whenPushSatisfies(requestsUploadToS3).setGoals(publishGoals),
    );
```

## Getting started

See the [Developer Quick Start][atomist-quick] to jump straight to
creating an SDM.

[atomist-quick]: https://docs.atomist.com/quick-start/ (Atomist - Developer Quick Start)

## Support

General support questions should be discussed in the `#support`
channel in the [Atomist community Slack workspace][slack].

If you find a problem, please create an [issue][].

[issue]: https://github.com/atomist/sdm-pack-s3/issues

## Development

See the [Atomist developer documentation][atomist-dev] for information
on how to write your own SDM features and automations.

[atomist-dev]: https://docs.atomist.com/developer/ (Atomist Developer Documentation)

### Release

Releases are handled via the [Atomist SDM][atomist-sdm].  Just press
the 'Approve' button in the Atomist dashboard or Slack.

[atomist-sdm]: https://github.com/atomist/atomist-sdm (Atomist Software Delivery Machine)

---

Created by [Atomist][atomist].
Need Help?  [Join our Slack workspace][slack].

[atomist]: https://atomist.com/ (Atomist - How Teams Deliver Software)
[slack]: https://join.atomist.com/ (Atomist Community Slack)
