<?php

$results = [];

$configPaths = json_decode(file_get_contents(__DIR__ . '/configPaths.json'), true);
unset($configPaths['-']);

foreach (glob("{$argv[1]}/*") as $path) {
    $json = file_get_contents($path);
    $parsed = json_decode($json);
    if (json_last_error() !== JSON_ERROR_NONE) {
        fwrite(STDERR, "{$path} was not json\n");
        continue;
    }

    $result = [];
    if (isset($parsed->all->config->product)) {
        $product = strtolower($parsed->all->config->product);
    } else {
        fwrite(STDERR, "{$path} has no product\n");
        continue;
    }

    if (isset($configPaths[$product])) {
        $result['configPath'] = $configPaths[$product];
    }
    if (isset($parsed->all->config->decryption_key_name)) {
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

    $results[$product] = $result;
}

foreach ($configPaths as $product => $path) {
    if (!isset($results[$product])) {
        $results[$product] = ['configPath' => $path];
    }
}

ksort($results);

echo json_encode($results);
