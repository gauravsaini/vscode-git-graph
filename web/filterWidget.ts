const CLASS_FILTER_WIDGET = 'filterWidget';

interface FilterWidgetState {
	readonly author: string;
	readonly revisionRange: string;
	readonly visible: boolean;
}

class FilterWidget {
	private readonly view: GitGraphView;
	private author: string = '';
	private revisionRange: string = '';
	private visible: boolean = false;

	private readonly widgetElem: HTMLElement;
	private readonly authorInputElem: HTMLInputElement;
	private readonly revisionRangeInputElem: HTMLInputElement;
	private readonly applyElem: HTMLElement;
	private readonly closeElem: HTMLElement;

	constructor(view: GitGraphView) {
		this.view = view;
		this.widgetElem = document.createElement('div');
		this.widgetElem.className = CLASS_FILTER_WIDGET;
		this.widgetElem.innerHTML = '<input id="filterAuthorInput" type="text" placeholder="Author" /><input id="filterRevisionRangeInput" type="text" placeholder="Revision Range" /><span id="filterApply" title="Apply Filter"></span><span id="filterClose" title="Close"></span>';
		document.body.appendChild(this.widgetElem);

		this.authorInputElem = <HTMLInputElement>document.getElementById('filterAuthorInput')!;
		this.authorInputElem.addEventListener('keyup', (e) => {
			if (e.key === 'Enter') {
				this.apply();
			}
		});

		this.revisionRangeInputElem = <HTMLInputElement>document.getElementById('filterRevisionRangeInput')!;
		this.revisionRangeInputElem.addEventListener('keyup', (e) => {
			if (e.key === 'Enter') {
				this.apply();
			}
		});

		this.applyElem = document.getElementById('filterApply')!;
		this.applyElem.innerHTML = SVG_ICONS.check;
		this.applyElem.addEventListener('click', () => this.apply());

		this.closeElem = document.getElementById('filterClose')!;
		this.closeElem.innerHTML = SVG_ICONS.close;
		this.closeElem.addEventListener('click', () => this.close());
	}

	public show(transition: boolean) {
		if (!this.visible) {
			this.visible = true;
			this.authorInputElem.value = this.author;
			this.revisionRangeInputElem.value = this.revisionRange;
			alterClass(this.widgetElem, CLASS_TRANSITION, transition);
			this.widgetElem.classList.add(CLASS_ACTIVE);
		}
		this.authorInputElem.focus();
	}

	public close() {
		if (!this.visible) return;
		this.visible = false;
		this.widgetElem.classList.add(CLASS_TRANSITION);
		this.widgetElem.classList.remove(CLASS_ACTIVE);
        this.view.saveState();
	}

	public apply() {
		if (this.author !== this.authorInputElem.value || this.revisionRange !== this.revisionRangeInputElem.value) {
			this.author = this.authorInputElem.value;
			this.revisionRange = this.revisionRangeInputElem.value;
			this.view.saveState();
			this.view.refresh(true);
		}
	}

	public getState(): FilterWidgetState {
		return {
			author: this.author,
			revisionRange: this.revisionRange,
			visible: this.visible
		};
	}

	public restoreState(state: FilterWidgetState) {
		this.author = state.author;
		this.revisionRange = state.revisionRange;
		if (state.visible) {
			this.show(false);
		}
	}

	public getAuthor() {
		return this.author;
	}

	public getRevisionRange() {
		return this.revisionRange;
	}
}
