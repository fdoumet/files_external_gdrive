<?php
/**
 * @author Hemant Mann <hemant.mann121@gmail.com>
 *
 * @copyright Copyright (c) 2017, ownCloud GmbH.
 * @license GPL-2.0
 * 
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
 * more details.
 * 
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 */

namespace OCA\Files_external_gdrive\Storage;

use Icewind\Streams\IteratorDirectory;
use League\Flysystem\FileNotFoundException;
use OC\Files\Storage\Flysystem;

/**
 * Generic Cacheable adapter between flysystem adapters and owncloud's storage system
 *
 * To use: subclass and call $this->buildFlysystem with the flysystem adapter of choice
 */
abstract class CacheableFlysystemAdapter extends Flysystem {
	/**
     * This property is used to check whether the storage is case insensitive or not
     * @var boolean
     */
    protected $isCaseInsensitiveStorage = false;

	/**
	 * Stores the results in cache for the current request to prevent multiple requests to the API
	 * @var array
	 */
	protected $cacheContents = [];

	public function clearCache() {
		$this->cacheContents = [];
		return $this;
	}

	protected function getContents() {
		if (count($this->cacheContents) === 0)
			$this->cacheFileObjects = $this->flysystem->listContents($this->root, true);

		return $this->cacheContents;
	}

	/**
	 * Get the location which will be used as a key in cache
	 * If Storage is not case sensitive then convert the key to lowercase
	 * @param  string $path Path to file/folder
	 * @return string
	 */
	public function getCacheLocation($path) {
		$location = $this->buildPath($path);
		if ($location === '') {
			$location = '/';
		}
		return $location;
	}

	public function buildPath($originalPath, $modifyCase = false) {
		if ($originalPath === '' || $originalPath === '.' || $originalPath === $this->root)
			return $this->root;

		$fullPath = \OC\Files\Filesystem::normalizePath($originalPath);

		if ($fullPath === '')
			return $this->root;

		$dirs = explode('/', substr($fullPath, 1));

		$file = end($dirs);
		unset($dirs[count($dirs) - 1]);


		$canReload = (count($this->cacheContents) > 0);
		$contents = $this->getContents();
		$path = 'root';
		$nbrSub = 1;

		foreach ($dirs as $dir) {
			$initNbr = $nbrSub;

			foreach ($contents as $key => $content) {
				if ($content['type'] !== 'dir')
					continue;

				if ($content['dirname'] === $path) {
					if ($content['basename'] === $dir) {
						$path = $content['path'];

						$nbrSub++;
						break;
					}

					unset($contents[$key]);
				}
				elseif (substr_count($content['dirname'], '/') <= $nbrSub)
					unset($contents[$key]);
			}

			if ($initNbr === $nbrSub)
				throw new FileNotFoundException(implode('/', array_slice($dirs, 0, $key)));
		}

		// We now try to find the file
		foreach ($contents as $content) {
			\OC::$server->getLogger()->error($content);
			if ($content['dirname'] === $path) {
				if ($content['basename'] === $file)
					return $content['path'];
			}
		}

		if ($canReload) {
			$this->cacheFileObjects = [];
			return $this->buildPath($originalPath);
		}

		return $path.'/'.$file;
	}

	/**
	 * Check if Cache Contains the data for given path, if not then get the data
	 * from flysystem and store it in cache for this request lifetime
	 * @param  string $path Path to file/folder
	 * @return array|boolean
	 */
	public function getFlysystemMetadata($path, $overRideCache = false) {
		$location = $this->getCacheLocation($path);
		if (!isset($this->cacheContents[$location]) || $overRideCache) {
			try {
				$this->cacheContents[$location] = $this->flysystem->getMetadata($location);
			} catch (FileNotFoundException $e) {
				// do not store this info in cache as it might interfere with Upload process
                return false;
			}
		}
		return $this->cacheContents[$location];
	}

	/**
	 * Store the list of files/folders in the cache so that subsequent requests in the
	 * same request life cycle does not call the flysystem API
	 * @param  array $contents Return value of $this->flysystem->listContents
	 */
	public function updateCache($contents) {
		foreach ($contents as $object) {
			$path = $this->isCaseInsensitiveStorage ? strtolower($object['path']) : $object['path'];
			$this->cacheContents[$path] = $object;
		}
	}

	/**
	 * {@inheritdoc}
	 */
	public function opendir($path) {
		try {
			// we need to preserve case to ensure the parent folder check is correct
			$location = $this->buildPath($path, false);
			$content = $this->flysystem->listContents($location);
			$this->updateCache($content);
		} catch (FileNotFoundException $e) {
			return false;
		}
		$names = array_map(function ($object) {
			return $object['basename'];
		}, $content);
		return IteratorDirectory::wrap($names);
	}

	/**
	 * {@inheritdoc}
	 */
	public function fopen($path, $mode) {
		switch ($mode) {
			case 'r':
			case 'rb':
				return parent::fopen($path, $mode);

			default:
				unset($this->cacheContents[$this->getCacheLocation($path)]);
				return parent::fopen($path, $mode);
		}
	}

	/**
	 * {@inheritdoc}
	 */
	public function filesize($path) {
		if ($this->is_dir($path)) {
			return 0;
		} else {
			$info = $this->getFlysystemMetadata($path);
			return $info['size'];
		}
	}

	/**
	 * {@inheritdoc}
	 */
	public function filemtime($path) {
		$info = $this->getFlysystemMetadata($path);
		return $info['timestamp'];
	}

	/**
	 * {@inheritdoc}
	 */
	public function stat($path) {
		$info = $this->getFlysystemMetadata($path);
		return [
			'mtime' => $info['timestamp'],
			'size' => $info['size']
		];
	}

	/**
	 * {@inheritdoc}
	 */
	public function filetype($path) {
		if ($path === '' or $path === '/' or $path === '.') {
			return 'dir';
		}
		$info = $this->getFlysystemMetadata($path);
		return $info['type'];
	}
}
