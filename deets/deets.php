<?php

$results = [];

$configPaths = json_decode(file_get_contents(__DIR__ . '/configPaths.json'), true);
unset($configPaths['-']);

foreach ($configPaths as $product => $path) {
    $results[$product] = ['configPath' => $path];
}

$hashMap = [];
$tempPath = $argv[1];
foreach (file("{$tempPath}/map.txt") as $line) {
    [$hash, $product, $type] = explode(' ', trim($line), 3);

    $path = "{$tempPath}/{$hash}";
    if (!file_exists($path)) {
        fwrite(STDERR, "Path [{$path}] for product [{$product}] does not exist.\n");
        continue;
    }
    if ($type === "BuildConfig") {
        // We couldn't get a product config, but we'll read a build config to see if it's encrypted.
        if (md5_file($path, true) !== hex2bin($hash)) {
            $results[$product]['encrypted'] = true;
        }
        continue;
    }
    if ($type !== "ProductConfig") {
        fwrite(STDERR, "Unknown map line type [{$type}] for product [{$product}]\n");
        continue;
    }

    $json = file_get_contents($path);
    $parsed = json_decode($json);
    if (json_last_error() !== JSON_ERROR_NONE) {
        fwrite(STDERR, "{$path} was not json\n");
        continue;
    }

    $result = [];

    if (isset($parsed->all->config->decryption_key_name)) {
        $result['encrypted'] = true;
        $result['key'] = $parsed->all->config->decryption_key_name;
    }
    if (isset($parsed->all->config->form->game_dir->dirname)) {
        $result['dirName'] = $parsed->all->config->form->game_dir->dirname;
    }
    foreach ($parsed->enus->config->install ?? [] as $installInfo) {
        if (isset($installInfo->add_remove_programs_key->display_name)) {
            $result['displayName'] = $installInfo->add_remove_programs_key->display_name;
        }
    }

    $result['name'] = $result['displayName'] ?? $result['dirName'] ?? null;
    unset($result['dirName'], $result['displayName']);
    if ($result['name'] === null) {
        unset($result['name']);
    }

    $results[$product] = [...($results[$product] ?? []), ...$result];
}

ksort($results);

echo json_encode($results);
