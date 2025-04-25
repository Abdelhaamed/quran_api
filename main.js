async function reciters() {
  const chosereciters = document.getElementById("all");
  const res = await fetch("https://mp3quran.net/api/v3/reciters");
  const data = await res.json();
  data.reciters.forEach((reciter) => {
    chosereciters.innerHTML += `<div class="qare" id="${reciter.id}" >${reciter.name}</div>`;
  });

  const choseqare = chosereciters.querySelectorAll(".qare");

  //search

  const inputsearch = document.getElementById("search");
  inputsearch.addEventListener("input", function () {
    const searchqare = inputsearch.value;
    choseqare.forEach((qare) => {
      const childtext = qare.textContent;
      if (childtext.includes(searchqare)) {
        qare.style.display = "block";
      } else {
        qare.style.display = "none";
      }
    });
  });

  ///////end search

  /////اظهار المزيد
  const showMoreButton = document.querySelector(".show-more");

  let displayedChildren = 40; // عدد العناصر المعروضة حاليًا

  showMoreButton.addEventListener("click", () => {
    displayedChildren += 40; // أضف 10 عناصر إضافية

    for (let i = 0; i < choseqare.length; i++) {
      if (i < displayedChildren) {
        choseqare[i].style.display = "block"; // إظهار عنصر فرعي
      } else {
        choseqare[i].style.display = "none"; // إخفاء عنصر فرعي
      }
    }

    // تحديث نص زر "إظهار المزيد" (اختياري)
    if (displayedChildren >= choseqare.length) {
      console.log("hhh");
      showMoreButton.style.display = "none";
      showMoreButton.disabled = true; // تعطيل الزر
    } else {
      showMoreButton.textContent = "إظهار المزيد";
    }
  });

  /////اظهار المزيد نهايه

  choseqare.forEach((qare) => {
    qare.addEventListener("click", (qare) => getmoshaf(qare.target.id));
  });
}
reciters();

async function getmoshaf(reciter) {
  const sur = document.querySelector(".surah");
  sur.style.display = "none";

  const choserya = document.getElementById("allr");
  const rya = document.querySelector(".rya");
  rya.style.display = "block";
  window.scrollTo({
    top: rya.offsetTop,
    behavior: "smooth",
  });
  const res = await fetch(
    `https://www.mp3quran.net/api/v3/reciters?language=ar&reciter=${reciter}`
  );
  const data = await res.json();
  choserya.innerHTML = `<div class="none" id="" ></div>`;

  data.reciters[0].moshaf.forEach((moshaf) => {
    choserya.innerHTML += `<div class="ryay" data-server="${moshaf.server}" data-list="${moshaf.surah_list}" id="${moshaf.id}" >${moshaf.name}</div>`;
  });

  const choserrya = choserya.querySelectorAll(".ryay");

  choserrya.forEach((ryay) => {
    ryay.addEventListener("click", (ryay) => {
      const surahserver = ryay.target.dataset.server;
      const surahlist = ryay.target.dataset.list;

      getsurah(surahserver, surahlist);
    });
  });
}

async function getsurah(surahserver, surahlist) {
  const chosesurah = document.getElementById("alls");
  const rya = document.querySelector(".surah");
  rya.style.display = "block";
  window.scrollTo({
    top: rya.offsetTop,
    behavior: "smooth",
  });
  const res = await fetch("https://mp3quran.net/api/v3/suwar");
  const data = await res.json();
  surahname = data.suwar;
  surahlist = surahlist.split(",");
  chosesurah.innerHTML = `<div class="none"  id="" ></div>`;

  surahlist.forEach((surah) => {
    const padsurah = surah.padStart(3, "0");
    surahname.forEach((surahname) => {
      if (surahname.id == surah) {
        chosesurah.innerHTML += `<div class="surah"  id="${surahserver}${padsurah}.mp3" >${surahname.name}</div>`;
      }
    });
  });
  const chosesur = chosesurah.querySelectorAll(".surah");
  chosesur.forEach((sur) => {
    sur.addEventListener("click", (sur) => {
      playsurah(sur.target.id);
    });
  });
}

function playsurah(link) {
  const audio = document.querySelector("#audio");
  audio.src = link;
  audio.play();
  window.scrollTo({
    top: audio.offsetTop,
    behavior: "smooth",
  });
}

function playvideo(live) {
  if (Hls.isSupported()) {
    var video = document.getElementById("videochanel");
    var hls = new Hls();
    hls.loadSource(`${live}`);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      video.play();
    });
  }
}

/// توقف الصوت
const audio = document.querySelector("#audio");
var video = document.getElementById("videochanel");

audio.addEventListener("play", () => {
  video.pause(); // إيقاف تشغيل الفيديو عند تشغيل الصوت
});

video.addEventListener("play", () => {
  audio.pause(); // إيقاف تشغيل الصوت عند تشغيل الفيديو
});
////////////////////

//go to top
function goToTop() {
  scroll({
    top: 0,
    behavior: "smooth",
  });

  // لصفحات XHTML
}

// جعل الزر مرئي عند التمرير إلى الأسفل
window.onscroll = function () {
  scrollFunction();
};

function scrollFunction() {
  if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
    document.getElementById("myBtn").style.display = "block";
  } else {
    document.getElementById("myBtn").style.display = "none";
  }
}
