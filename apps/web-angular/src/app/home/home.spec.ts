import { TestBed } from "@angular/core/testing";
import { Home } from "./home";

describe("Home", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
    }).compileComponents();
  });

  it("should render JobTracker", () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector("main")?.textContent).toContain("JobTracker");
  });
});
