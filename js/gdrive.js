$(document).ready(function () {
	var backendId = 'files_external_gdrive';
	var backendUrl = OC.generateUrl('apps/' + backendId + '/oauth');

	function displayGranted ($tr) {
		$tr.find('.configuration input.auth-param').attr('disabled', 'disabled').addClass('disabled-success');
	}

	OCA.External.Settings.mountConfig.whenSelectAuthMechanism(function ($tr, authMechanism, scheme, onCompletion) {
		if (authMechanism === 'oauth2::oauth2') {
			var config = $tr.find('.configuration');
			// hack to prevent conflict with oauth2 code from files_external
			// wait for files_external to setup the config ui and then change the button
			setTimeout(function () {
				config.find('[name="oauth2_grant"]')
					.attr('name', 'oauth2_grant_gdrive');
			}, 50);

			onCompletion.then(function () {
				var configured = $tr.find('[data-parameter="configured"]');
				if ($(configured).val() == 'true') {
					displayGranted($tr);
				} else {
					var client_id = "dummy_id";
					var client_secret = "dummy_secret";

					var params = {};
					window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) {
						params[key] = value;
					});

					if (
						params.code !== undefined
						&& typeof client_id === "string"
						&& client_id !== ''
						&& typeof client_secret === "string"
						&& client_secret !== ''
					) {
						$('.configuration').trigger('oauth_step2', [{
							backend_id: $tr.attr('class'),
							client_id: client_id,
							client_secret: client_secret,
							redirect: location.protocol + '//' + location.host + location.pathname,
							tr: $tr,
							code: params.code || '',
							state: params.state || ''
						}]);
					}
				}
			});
		}
	});

	$('#externalStorage').on('click', '[name="oauth2_grant_gdrive"]', function (event) {
		event.preventDefault();
		var tr = $(this).parent().parent();
		var client_id = "dummy_id";
		var client_secret = "dummy_secret";
		if (client_id !== '' && client_secret !== '') {
			$('.configuration').trigger('oauth_step1', [{
				backend_id: tr.attr('class'),
				client_id: client_id,
				client_secret: client_secret,
				redirect: location.protocol + '//' + location.host + location.pathname,
				tr: tr
			}]);
		}
	});

	$('.configuration').on('oauth_step1', function (event, data) {
		console.log('b', data);

		if (data['backend_id'] !== backendId) {
			return false;	// means the trigger is not for this storage adapter
		}

		OCA.External.Settings.OAuth2_Gdrive.getAuthUrl(backendUrl, data);
	});

	$('.configuration').on('oauth_step2', function (event, data) {
		if (data['backend_id'] !== backendId || data['code'] === undefined) {
			return false;		// means the trigger is not for this OAuth2 grant
		}

		OCA.External.Settings.OAuth2_Gdrive.verifyCode(backendUrl, data)
			.fail(function (message) {
				OC.dialogs.alert(message,
					t(backendId, 'Error verifying OAuth2 Code for ' + backendId)
				);
			})
	});
});

/**
 * @namespace OAuth2 namespace which is used to verify a storage adapter
 *            using AuthMechanism as oauth2::oauth2
 */
OCA.External.Settings.OAuth2_Gdrive = OCA.External.Settings.OAuth2 || {};

/**
 * This function sends a request to the given backendUrl and gets the OAuth2 URL
 * for any given backend storage, executes the callback if any, set the data-* parameters
 * of the storage and REDIRECTS the client to Authentication page
 *
 * @param  {String}   backendUrl The backend URL to which request will be sent
 * @param  {Object}   data       Keys -> (backend_id, client_id, client_secret, redirect, tr)
 */
OCA.External.Settings.OAuth2_Gdrive.getAuthUrl = function (backendUrl, data) {
	$('.configuration [data-parameter="client_id"]').val("dummy_id");
	$('.configuration [data-parameter="client_secret"]').val("dummy_secret");

	var $tr = data['tr'];
	var configured = $tr.find('[data-parameter="configured"]');
	var token = $tr.find('.configuration [data-parameter="token"]');

	$.post(backendUrl, {
			step: 1,
			client_id: data['client_id'],
			client_secret: data['client_secret'],
			redirect: data['redirect'],
		}, function (result) {
			if (result && result.status == 'success') {
				$(configured).val('false');
				$(token).val('false');

				OCA.External.Settings.mountConfig.saveStorageConfig($tr, function (status) {
					if (!result.data.url) {
						OC.dialogs.alert('Auth URL not set',
							t('files_external', 'No URL provided by backend ' + data['backend_id'])
						);
					} else {
						window.location = result.data.url;
					}
				});
			} else {
				OC.dialogs.alert(result.data.message,
					t('files_external', 'Error getting OAuth2 URL for ' + data['backend_id'])
				);
			}
		}
	);
};

/**
 * This function verifies the OAuth2 code returned to the client after verification
 * by sending request to the backend with the given CODE and if the code is verified
 * it sets the data-* params to configured and disables the authorize buttons
 *
 * @param  {String}   backendUrl The backend URL to which request will be sent
 * @param  {Object}   data       Keys -> (backend_id, client_id, client_secret, redirect, tr, code)
 * @return {Promise} jQuery Deferred Promise object
 */
OCA.External.Settings.OAuth2_Gdrive.verifyCode = function (backendUrl, data) {
	$('.configuration [data-parameter="client_id"]').val("dummy_id");
	$('.configuration [data-parameter="client_secret"]').val("dummy_secret");

	var $tr = data['tr'];
	var configured = $tr.find('[data-parameter="configured"]');
	var token = $tr.find('.configuration [data-parameter="token"]');
	var statusSpan = $tr.find('.status span');
	statusSpan.removeClass().addClass('waiting');

	var deferredObject = $.Deferred();
	$.post(backendUrl, {
			step: 2,
			client_id: data['client_id'],
			client_secret: data['client_secret'],
			redirect: data['redirect'],
			code: data['code'],
			state: data['state']
		}, function (result) {
			if (result && result.status == 'success') {
				$(token).val(result.data.token);
				$(configured).val('true');

				OCA.External.Settings.OAuth2_Gdrive.saveStorageConfig($tr, function (status) {
					if (status) {
						$tr.find('.configuration input.auth-param')
							.attr('disabled', 'disabled')
							.addClass('disabled-success')
					}
					deferredObject.resolve(status);
				});
			} else {
				deferredObject.reject(result.data.message);
			}
		}
	);
	return deferredObject.promise();
};

OCA.External.Settings.OAuth2_Gdrive.saveStorageConfig = function ($tr, callback, concurrentTimer) {
		var storage = OCA.External.Settings.mountConfig.getStorageConfig($tr);
		if (!storage || !storage.validate()) {
			return false;
		}

	OCA.External.Settings.mountConfig.updateStatus($tr, -1);
	OCA.External.Settings.OAuth2_Gdrive.saveConfig(storage,{
			success: function(result) {
				if (concurrentTimer === undefined
					|| $tr.data('save-timer') === concurrentTimer
				) {
					OCA.External.Settings.mountConfig.updateStatus($tr, result.status);
					$tr.data('id', result.id);

					if (_.isFunction(callback)) {
						callback(storage);
					}
				}
			},
			error: function() {
				if (concurrentTimer === undefined
					|| $tr.data('save-timer') === concurrentTimer
				) {
					OCA.External.Settings.mountConfig.updateStatus($tr, 1);
				}
			}
		});
}

OCA.External.Settings.OAuth2_Gdrive.saveConfig = function (config, options){
	var configUrl = config._url.replace("files_external", "files_external_gdrive");
	var url = OC.generateUrl(configUrl);
	var method = 'POST';
	if (_.isNumber(config.id)) {
		url = OC.generateUrl(configUrl + '/{id}', {id: config.id});
	}

	$.ajax({
		type: method,
		url: url,
		contentType: 'application/json',
		data: JSON.stringify(config.getData()),
		success: function(result) {
			config.id = result.id;
			if (_.isFunction(options.success)) {
				options.success(result);
			}
		},
		error: options.error
	});
}
