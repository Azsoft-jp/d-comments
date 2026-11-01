# 合成メディア

`solid-blue.webm`は、外部素材を使わずFFmpegのcolorフィルターで生成した12秒の単色映像である。
放送映像、録音、ユーザー情報は含まない。テスト素材は本リポジトリと同じGPL-3.0で提供する。

生成コマンドは次のとおり。テスト実行時にFFmpegをインストールする必要はない。

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'color=c=0x184060:s=640x360:r=24:d=12' \
  -c:v libvpx -b:v 80k -an tests/fixtures/solid-blue.webm
```
