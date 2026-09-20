import { Link } from "react-router-dom";
import { Button, Panel } from "@/components/ui/nexus";

/**
 * Presentational next-step strip. Heading stays below h1 so Resumen keeps a
 * single page title.
 */
const RitualNextStep = ({
	step,
	title,
	detail,
	cta,
	onRetry,
	here = false,
}) => {
	if (!step) return null;

	let actions = null;
	if (step.id === "unavailable") {
		actions = (
			<Button type="button" onClick={onRetry}>
				{cta}
			</Button>
		);
	} else if (step.href && cta && !here) {
		actions = (
			<Link
				to={step.href}
				className="label-mono flex-shrink-0 text-[var(--color-accent)] transition-opacity hover:opacity-80"
			>
				{cta}
			</Link>
		);
	}

	return (
		<section data-testid="ritual-next-step">
			<Panel title={title} actions={actions}>
				<p className="text-[13px] text-[var(--color-fg-4)]">{detail}</p>
			</Panel>
		</section>
	);
};

export default RitualNextStep;
