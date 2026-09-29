// Footer logo easter egg: the first click turns the logo into pixel art (a larger floating copy pops up
// above it, since the footer strip clips anything taller); a second click goes to the isometric Northland map.
const TARGET = "https://isometric.northland.eco/";
export function initEgg() {
  const img = document.getElementById("foot-logo"); if (!img) return;
  new Image().src = "assets/icon-pixel.svg"; // preload so the swap is instant
  let pop = null, timer = null;
  const reset = () => { clearTimeout(timer); pop?.remove(); pop = null; img.src = "assets/icon.svg"; img.style.cursor = ""; };
  const go = () => { location.href = TARGET; };
  img.addEventListener("click", () => {
    if (pop) { go(); return; }
    img.src = "assets/icon-pixel.svg"; img.style.cursor = "pointer";
    const r = img.getBoundingClientRect();
    pop = document.createElement("img"); pop.id = "egg-pop"; pop.src = "assets/icon-pixel.svg"; pop.alt = ""; pop.title = "Click again…";
    pop.style.left = Math.max(4, r.left - 2) + "px"; pop.style.bottom = Math.round(innerHeight - r.top + 6) + "px";
    pop.addEventListener("click", go); document.body.append(pop);
    timer = setTimeout(reset, 8000); // quietly goes back if nobody clicks again
  });
}
