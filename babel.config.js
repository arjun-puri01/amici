module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Apply private-field transforms only to @supabase packages.
    // Using global loose:true breaks React Navigation v7, which has frozen
    // constants that simple assignment (loose mode) tries to overwrite.
    overrides: [
      {
        test: /node_modules\/@supabase/,
        plugins: [
          ['@babel/plugin-transform-class-properties', { loose: true }],
          ['@babel/plugin-proposal-private-methods', { loose: true }],
        ],
      },
    ],
  };
};
