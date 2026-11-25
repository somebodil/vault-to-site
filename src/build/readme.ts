/**
 * The few lines that go into every site as `README.txt`, for the one who
 * gets the archive without having built it: how to open it, and how to put it
 * on the web. Written in Korean when Obsidian is set to Korean, else in
 * English. Nothing in it changes from build to build of the same vault.
 */
export function siteReadme(name: string, language: string): string {
  const lines = language.toLowerCase().startsWith("ko")
    ? [
        name,
        "",
        "이 폴더는 읽기 전용으로 만든 노트 웹사이트입니다. 읽는 것으로는 아무것도 바뀌지 않습니다.",
        "",
        "읽는 방법",
        "1. zip 압축 파일로 받았다면 먼저 전체를 풉니다. 압축 파일 안에서 index.html을 바로 열면 빈 화면이 나옵니다.",
        "2. index.html을 웹 브라우저로 엽니다. 서버도 인터넷 연결도 필요 없습니다.",
        "",
        "웹에 올리는 방법",
        "이 폴더의 모든 파일을 그대로, 파일을 그대로 내주는 곳에 올립니다: GitHub Pages, 정적 웹 호스팅을 켠 S3 버킷, Netlify, 또는 일반 웹 서버.",
        "사이트의 하위 폴더에 두어도 됩니다.",
        "사이트는 노트를 보이지 않는 프레임으로 읽습니다. 서버가 모든 페이지에 X-Frame-Options: DENY나 frame-ancestors 'none'을 보내면 노트가 열리지 않으니, 같은 출처의 프레임은 허용합니다 (SAMEORIGIN, 'self').",
        "올리면 주소를 아는 사람은 누구나 이 안의 모든 노트를 읽을 수 있습니다.",
        "",
        "들어 있는 것",
        "index.html   여는 페이지",
        "app/         사이트의 스크립트와 스타일시트",
        "data/        노트와 검색용 데이터",
        "assets/      노트가 쓰는 그림과 그 밖의 파일",
        "",
        "Obsidian vault에서 vault-to-site 플러그인으로 만들었습니다. 만든 시점의 노트를 보여 줍니다.",
      ]
    : [
        name,
        "",
        "This folder is a website of notes, made to be read. Reading it changes nothing in it.",
        "",
        "TO READ IT",
        "1. If it came as a zip archive, unpack all of it first. index.html opened from inside the archive shows an empty page.",
        "2. Open index.html with a web browser. It needs no server and no network.",
        "",
        "TO PUT IT ON THE WEB",
        "Upload everything in this folder, as it is, to a place that serves plain files: GitHub Pages, an S3 bucket with static website hosting, Netlify, or any web server.",
        "It also works in a folder below the top of a site.",
        "The site reads its notes through frames that are not seen. A server that sends X-Frame-Options: DENY or frame-ancestors 'none' with every page keeps the notes from opening: allow frames from the same origin (SAMEORIGIN, 'self').",
        "Then everyone who has the address can read every note in it.",
        "",
        "WHAT IS IN IT",
        "index.html   the page to open",
        "app/         the script and the style sheets of the site",
        "data/        the notes, and what the search looks through",
        "assets/      the pictures and other files that the notes use",
        "",
        "Built from an Obsidian vault with the plugin vault-to-site. It shows the notes as they were when it was built.",
      ];
  return lines.join("\n") + "\n";
}
