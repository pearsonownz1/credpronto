import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "samples");

const ink = rgb(0.07, 0.07, 0.07);
const muted = rgb(0.35, 0.35, 0.35);

async function drawDocument(filename, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const page of pages) {
    const sheet = doc.addPage([612, 792]);
    sheet.drawRectangle({
      x: 36,
      y: 36,
      width: 540,
      height: 720,
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 1,
    });
    sheet.drawText(page.title, {
      x: 54,
      y: 720,
      size: 16,
      font: bold,
      color: ink,
    });
    let y = 688;
    for (const line of page.lines) {
      sheet.drawText(line, { x: 54, y, size: 11, font, color: ink });
      y -= 18;
    }
    sheet.drawText("SYNTHETIC SAMPLE. NOT A REAL RECORD. CredPronto", {
      x: 54,
      y: 52,
      size: 9,
      font,
      color: muted,
    });
  }

  const bytes = await doc.save();
  const file = path.join(outDir, filename);
  await mkdir(outDir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, bytes);
}

const certificateEs = [
  {
    title: "ACTA DE NACIMIENTO (MUESTRA)",
    lines: [
      "Registro Civil de Ejemplo  -  Estado de Muestra",
      "Tomo DEMO   Folio 0001   Acta 0001",
      "",
      "Nombre: Ejemplo Ficticio Garcia",
      "Fecha de nacimiento: 1 de enero de 1990",
      "Lugar: Ciudad Muestra",
      "Sexo: No especificado (dato de demostracion)",
      "",
      "Padre: Padre Muestra Lopez",
      "Madre: Madre Muestra Ruiz",
      "",
      "Este documento es ficticio. No identifica a una persona real.",
      "Se genero solo para probar el visor de CredPronto.",
    ],
  },
  {
    title: "ANOTACIONES MARGINALES (MUESTRA)",
    lines: [
      "Acta 0001  -  Ejemplo Ficticio Garcia",
      "",
      "No hay anotaciones reales en este ejemplar.",
      "Linea de muestra 1: cambio de domicilio ficticio, 2010.",
      "Linea de muestra 2: nota administrativa de demostracion.",
      "",
      "Sello: DEMOSTRACION",
      "Oficina: Ventanilla de Ejemplo",
    ],
  },
  {
    title: "CERTIFICACION DE COPIA (MUESTRA)",
    lines: [
      "La oficina de muestra certifica que esta copia es sintetica.",
      "",
      "Funcionario: Oficio de Demostracion",
      "Fecha de expedicion: 1 de marzo de 2024",
      "Numero de control: DEMO-0000",
      "",
      "Texto legal de relleno. No tiene validez oficial.",
      "CredPronto usa este PDF para la vista previa lado a lado.",
    ],
  },
];

const certificateEn = [
  {
    title: "BIRTH CERTIFICATE (SAMPLE)",
    lines: [
      "Sample Civil Registry  -  State of Example",
      "Volume DEMO   Folio 0001   Record 0001",
      "",
      "Name: Ejemplo Ficticio Garcia",
      "Date of birth: 1 January 1990",
      "Place: Sample City",
      "Sex: Unspecified (demonstration data)",
      "",
      "Father: Padre Muestra Lopez",
      "Mother: Madre Muestra Ruiz",
      "",
      "This document is fictional. It does not identify a real person.",
      "It was generated only to exercise the CredPronto viewer.",
    ],
  },
  {
    title: "MARGINAL NOTES (SAMPLE)",
    lines: [
      "Record 0001  -  Ejemplo Ficticio Garcia",
      "",
      "There are no real annotations on this copy.",
      "Sample line 1: fictional change of address, 2010.",
      "Sample line 2: demonstration administrative note.",
      "",
      "Stamp: DEMONSTRATION",
      "Office: Example Counter",
    ],
  },
  {
    title: "COPY CERTIFICATION (SAMPLE)",
    lines: [
      "The sample office certifies that this copy is synthetic.",
      "",
      "Officer: Demonstration Clerk",
      "Issue date: 1 March 2024",
      "Control number: DEMO-0000",
      "",
      "Filler legal text. It has no official effect.",
      "CredPronto uses this PDF for the side-by-side preview.",
    ],
  },
];

function longPages(language) {
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const spanish = language === "es";
    return {
      title: spanish
        ? `DOCUMENTO LARGO DE MUESTRA  -  Pagina ${number} de 12`
        : `LONG SAMPLE DOCUMENT  -  Page ${number} of 12`,
      lines: [
        spanish
          ? "Texto sintetico para probar desplazamiento y zoom."
          : "Synthetic text for scroll and zoom testing.",
        spanish
          ? `Bloque ${number}. Ningun dato personal real aparece aqui.`
          : `Block ${number}. No real personal data appears here.`,
        "",
        ...Array.from({ length: 24 }, (_, line) =>
          spanish
            ? `Linea ${line + 1}. Muestra CredPronto ${number}.${line + 1}.`
            : `Line ${line + 1}. CredPronto sample ${number}.${line + 1}.`,
        ),
      ],
    };
  });
}

await drawDocument("birth-certificate-es.pdf", certificateEs);
await drawDocument("birth-certificate-en.pdf", certificateEn);
await drawDocument("long-es.pdf", longPages("es"));
await drawDocument("long-en.pdf", longPages("en"));
console.log("Wrote sample PDFs to public/samples");
