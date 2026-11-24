// Regras puras da receita do enfermeiro na porta própria: o protocolo gravado e lido, o tipo de receita pelo modelo e a
// validade pela data civil da emissão.
import { describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import {
  entradaDaChave,
  filtroDoModelo,
  protocoloGravado,
  protocoloLido,
  type ReceitaEnfermeiroComTexto,
  sha256,
  textoConferido,
  validadeDe,
} from './sae-porta-propria-receita.js';

const TEXTO = 'Receita sintética\nparacetamol';
const base: ReceitaEnfermeiroComTexto = {
  paciente: 1,
  atendimento: 2,
  protocolo: 'P',
  ano: 2026,
  tipoProtocolo: 'institucional',
  modelo: 'simples',
  listaVersao: 'v1',
  segundoIdentificador: 'cpf',
  coren: 'COREN-SP 1',
  categoria: 'Enfermeiro',
  itens: [{ medicamento: 'm', via: 'oral', posologia: 'p', quantidade: '1' }],
  impressao: sha256(TEXTO),
  texto: TEXTO,
  assinadaEm: '2026-11-24T10:30:15',
  vinculo: 3,
  usuario: 'u',
  chave: 'k',
};
const codigo = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? e.problema['codigo'] : e;
  }
};

describe('receita do enfermeiro (porta própria, regras puras)', () => {
  it('grava o protocolo como CODIGO/ANO e lê de volta (o código pode ter barra só antes do ano)', () => {
    expect(protocoloGravado('PROT-ENF.1', 2026)).toBe('PROT-ENF.1/2026');
    expect(protocoloLido('PROT-ENF.1/2026')).toEqual({ protocolo: 'PROT-ENF.1', ano: 2026 });
    expect(protocoloLido('SEM-ANO')).toEqual({ protocolo: 'SEM-ANO', ano: 0 });
  });

  it('o modelo de retenção é o tipo de antimicrobiano; o simples, o sem controle', () => {
    expect(filtroDoModelo('retencao')).toBe('antimicrobiano = TRUE AND controle_especial = FALSE');
    expect(filtroDoModelo('simples')).toBe('antimicrobiano = FALSE AND controle_especial = FALSE');
  });

  it('a validade soma os dias do tipo à data civil da emissão (nula sem os dias)', () => {
    expect(validadeDe('2026-11-24T10:30', 10)).toBe('2026-12-04');
    expect(validadeDe('2026-12-28T23:59', 10)).toBe('2027-01-07');
    expect(validadeDe('2026-11-24T10:30', null)).toBeNull();
    expect(validadeDe('2026-11-24T10:30', 0)).toBeNull();
  });

  it('o texto assinado só passa com a impressão SHA-256 dele; sem o texto, falha fechada', () => {
    expect(textoConferido(base)).toBe(TEXTO);
    expect(codigo(() => textoConferido({ ...base, texto: `${TEXTO} ` }))).toBe('impressao-divergente');
    expect(codigo(() => textoConferido({ ...base, texto: null }))).toBe('receita-sem-texto');
    expect(codigo(() => textoConferido({ ...base, texto: undefined }))).toBe('receita-sem-texto');
  });

  it('o hash da chave do pedido não cobre o relógio nem a impressão, e cobre o atendimento e o conteúdo', () => {
    const outroHorario = { ...base, assinadaEm: '2026-11-25T08:00:00', impressao: sha256('outro dia') };
    expect(entradaDaChave(outroHorario)).toEqual(entradaDaChave(base));
    expect(entradaDaChave({ ...base, atendimento: 9 })).not.toEqual(entradaDaChave(base));
    expect(entradaDaChave({ ...base, modelo: 'retencao' })).not.toEqual(entradaDaChave(base));
    expect(entradaDaChave(base)).not.toHaveProperty('texto');
  });
});
