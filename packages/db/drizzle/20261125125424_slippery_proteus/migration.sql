ALTER TABLE `integrationEvents` ADD `accountId` text;--> statement-breakpoint
ALTER TABLE `integrationEvents` ADD `accountName` text;--> statement-breakpoint
ALTER TABLE `integrations` ADD `allowedAccountIds` text;--> statement-breakpoint
CREATE INDEX `integrationEvents_integrationId_accountId` ON `integrationEvents` (`integrationId`,`accountId`);