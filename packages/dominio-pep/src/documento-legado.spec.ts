import { describe, expect, it } from 'vitest';
import {
  cabecalhoDoAto,
  comOrigem,
  documentoAtestado,
  documentoExameExterno,
  documentoPedidoExame,
  documentoReceita,
  horaUtc,
} from './documento-legado.js';
import { filho, filhosElemento, lerXml, textoXml } from './prontuario/xml-seguro.js';

const cab = {
  hospital: [['nome', 'HOSPITAL SINTETICO']] as const,
  paciente: [
    ['id_htpaciente', 1],
    ['nome', 'PACIENTE SINTETICO'],
  ] as const,
  atendimento: [['registro', 99]] as const,
  profissional: [['nome', 'PROFISSIONAL SINTETICO']] as const,
  tipoAssinatura: 'Receita médica',
  situacao: 'Lançado',
};

describe('documento da trilha documental (M23)', () => {
  it('cabeçalho do ato com o evento e a suspensão', () => {
    expect(horaUtc('2026-10-21T10:30')).toBe('2026-10-21T10:30:00.0000-03:00');
    expect(horaUtc('2026-10-21T10:30:15')).toBe('2026-10-21T10:30:15.0000-03:00');
    const c = cabecalhoDoAto(cab, '2026-10-21T10:30');
    expect(c.lancamento.map((x) => x[0])).toEqual([
      'id_tabela_origem',
      'tipo_assinatura',
      'situacao_documento',
      'data_hora_evento',
      'profissional_evento',
    ]);
    const s = cabecalhoDoAto(cab, '2026-10-21T10:30', {
      profissional: cab.profissional,
      justificativa: 'Paciente errado SINTETICO',
      em: '2026-10-21T11:00',
      gravadoEm: '2026-10-21T11:00:05',
    });
    expect(s.lancamento.map((x) => x[0]).slice(5)).toEqual([
      'profissional_suspensao',
      'justificativa_suspensao',
      'data_hora_suspensao',
      'data_hora_gravacao_suspensao',
    ]);
  });

  it('receita, atestado, pedido e exame externo: XML legível com a parte do tipo', () => {
    const c = cabecalhoDoAto(cab, '2026-10-21T10:30');
    const r = lerXml(
      comOrigem(documentoReceita(c, '1) DIPIRONA', '{\\rtf1 x}'), 77).replace(/^<\?xml[^>]*>\s*/, ''),
    );
    expect(textoXml(filho(filho(r, 'lancamento')!, 'id_tabela_origem'))).toBe('77');
    expect(textoXml(filho(r, 'receita_texto'))).toBe('1) DIPIRONA');
    const a = lerXml(documentoAtestado(c, 'Atesto', '<atestado/>').replace(/^<\?xml[^>]*>\s*/, ''));
    expect(textoXml(filho(a, 'conteudo'))).toBe('<atestado/>');
    const p = lerXml(
      documentoPedidoExame(c, 123, [
        {
          controle: 123,
          codigoAlfa: 'HEMO',
          descricao: 'HEMOGRAMA',
          material: null,
          seq: 1,
          ato: 'Laboratório',
          previsaoColeta: '21/10/2026 10:30',
          urgente: true,
          informacoes: null,
        },
      ]).replace(/^<\?xml[^>]*>\s*/, ''),
    );
    const itens = filhosElemento(filho(p, 'itens')!, 'item');
    expect(itens).toHaveLength(1);
    expect(textoXml(filho(itens[0]!, 'exame_de_urgencia'))).toBe('Sim');
    expect(filho(itens[0]!, 'material')).toBeNull();
    const e = lerXml(
      documentoExameExterno(c, '2026-10-20T08:00', true, null, [{ elemento: 'HB', tipo: 'N' }]).replace(
        /^<\?xml[^>]*>\s*/,
        '',
      ),
    );
    expect(textoXml(filho(e, 'achadocritico'))).toBe('T');
    expect(filho(e, 'resultado_rtf')).toBeNull();
    expect(documentoExameExterno(c, '2026-10-20T08:00', false, '{\\rtf1}', [])).toContain(
      '<achadocritico>F<',
    );
  });
});
