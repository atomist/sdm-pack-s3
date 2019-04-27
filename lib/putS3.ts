import { logger, Project, ProjectFile } from "@atomist/automation-client";
import { doWithFiles } from "@atomist/automation-client/lib/project/util/projectUtils";
import { GoalInvocation, ProgressLog } from "@atomist/sdm";
import { S3 } from "aws-sdk";
import * as mime from "mime-types";
import { PublishToS3Options } from "./options";

type FilesAttempted = number;
type SuccessfullyPushedKey = string;
type Warning = string;

export async function putFiles(
    project: Project,
    inv: GoalInvocation,
    s3: S3,
    params: PublishToS3Options): Promise<[FilesAttempted, SuccessfullyPushedKey[], Warning[]]> {
    const { bucketName, filesToPublish, pathTranslation } = params;
    let fileCount = 0;
    const log = inv.progressLog;
    const keys: SuccessfullyPushedKey[] = [];
    const warnings: Warning[] = [];
    let pleaseGiveUp: boolean = false;
    await doWithFiles(project, filesToPublish, async file => {
        if (pleaseGiveUp) {
            log.write("Due to previous error, skipping attempt to write " + file.path);
            return;
        }
        fileCount++;
        const key = pathTranslation(file.path, inv);
        const contentType = mime.lookup(file.path) || "text/plain";
        const content = await file.getContentBuffer();
        let fileParams: Partial<S3.Types.PutObjectRequest> = {};
        if (params.paramsExt) {
            const [retrievedFileParams, additionalWarnings] = await gatherParamsFromCompanionFile(project, log, file, params.paramsExt);
            fileParams = retrievedFileParams;
            additionalWarnings.forEach(w => warnings.push(w));
        }
        const objectParams = {
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: contentType,
            ...fileParams,
        };
        logger.debug(`File: ${file.path}, key: ${key}, contentType: ${contentType}`);
        try {
            await s3.putObject(objectParams).promise();
            keys.push(key);
            log.write(`Put '${file.path}' to 's3://${bucketName}/${key}'`);
        } catch (e) {
            const msg = `Failed to put '${file.path}' to 's3://${bucketName}/${key}': ${e.message}`;
            log.write(msg);
            warnings.push(msg);
            if (e.code === "InvalidAccessKeyId") {
                log.write("Credential error detected. We should not try any more files");
                pleaseGiveUp = true;
            }
        }
    });
    return [fileCount, keys, warnings];
}

async function gatherParamsFromCompanionFile(project: Project,
                                             log: ProgressLog,
                                             file: ProjectFile,
                                             companionFileExtension: string): Promise<[Partial<S3.Types.PutObjectRequest>, string[]]> {
    const companionFilePrefix = ".";
    const paramsPath = file.path.replace(escapeSpecialCharacters(file.name),
        `${companionFilePrefix}${file.name}${companionFileExtension}`);
    const paramsFile = await project.getFile(paramsPath);
    if (!paramsFile) {
        return [{}, []];
    }
    try {
        const fileParams = JSON.parse(await paramsFile.getContent());
        log.write(`Merging in S3 parameters from '${paramsPath}': ${JSON.stringify(fileParams)}`);
        return [fileParams, []];
    } catch (e) {
        const msg = `Failed to read and parse S3 params file '${paramsPath}', using defaults: ${e.message}`;
        log.write(msg);
        return [{}, [msg]];
    }
}

export function escapeSpecialCharacters(filename: string): RegExp {
    return new RegExp(filename.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&") + "$");
}
