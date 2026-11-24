// Ligação das portas do PEP (portasDoPep): no banco próprio (núcleo presente e cliente configurado), todas as seis portas
// são as próprias sobre o banco do cliente; nenhuma recusa por indisponibilidade. Sem núcleo e sem fontes sintéticas,
// continuam as que recusam. As portas dadas nas opções (testes) têm precedência.
import { describe, expect, it } from 'vitest';
import type { ContextoModulo } from '../registro.js';
import { PortaDocumentosPropria } from './documentos-porta-propria.js';
import { PortaFormularioNovoPropria } from './formulario-novo-porta-propria.js';
import { portasDoPep } from './modulo.js';
import { PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import { PortaProntuarioPropria } from './prontuario-porta-propria.js';
import { PortaRegistroPropria } from './registro-porta-propria.js';
import { PortaWorklistPropria } from './worklist-porta-propria.js';

/** Núcleo de mentira: as portas só o guardam (e pedem o executor) na construção; nada vai ao banco aqui. */
const nucleo = { criarExecutor: () => ({}) };

const contexto = (comNucleo: boolean): ContextoModulo =>
  ({
    configuracao: { clientePadrao: 'teste' },
    nucleo: comNucleo ? nucleo : null,
    env: {},
    trilha: { registrar: async () => undefined },
  }) as unknown as ContextoModulo;

describe('portasDoPep', () => {
  it('banco próprio: as seis portas são as próprias', () => {
    const p = portasDoPep(contexto(true));
    expect(p.prontuario).toBeInstanceOf(PortaProntuarioPropria);
    expect(p.registro).toBeInstanceOf(PortaRegistroPropria);
    expect(p.formularioNovo).toBeInstanceOf(PortaFormularioNovoPropria);
    expect(p.prescricao).toBeInstanceOf(PortaPrescricaoPropria);
    expect(p.documentos).toBeInstanceOf(PortaDocumentosPropria);
    expect(p.worklist).toBeInstanceOf(PortaWorklistPropria);
  });

  it('banco próprio: a porta dada nas opções tem precedência', () => {
    const dada = new PortaProntuarioPropria(nucleo as never, 'outro');
    expect(portasDoPep(contexto(true), { prontuario: dada }).prontuario).toBe(dada);
  });

  it('sem núcleo e sem fontes sintéticas: nenhuma porta própria', () => {
    const p = portasDoPep(contexto(false));
    for (const porta of Object.values(p)) {
      expect(
        [
          PortaProntuarioPropria,
          PortaRegistroPropria,
          PortaFormularioNovoPropria,
          PortaPrescricaoPropria,
          PortaDocumentosPropria,
          PortaWorklistPropria,
        ].some((c) => porta instanceof c),
      ).toBe(false);
    }
  });
});
