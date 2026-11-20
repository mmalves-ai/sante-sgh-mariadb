// W0-09 (programa CRUD completo; D-RETRO-REGISTRO-F6): como se gravam o registro do fim da coexistência (M43) e o da
// retrocompatibilidade (M59, etapa 6). Os dois caminhos estão construídos e o dono escolhe aqui:
//   - 'tela': grava pela tela, com a senha de novo e a trilha; cada gravação é uma versão nova (SGH_CFG_COEX_REGISTRO,
//     script 1123, só inclusão) e a última vale sobre o registro versionado (docs/coexistencia/...);
//   - 'excecao': fica só o registro versionado (por PR revisado) e a falta da gravação pela tela é a exceção registrada
//     ao CRUD completo; a API recusa a gravação com 409 e o motivo.
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETROS_COEX_REGISTRO: readonly DefinicaoParametro[] = [
  {
    chave: 'coexistencia.registro.modo',
    modulo: 'coexistencia',
    descricao:
      'Registro do fim da coexistência e da retrocompatibilidade: gravar pela tela (senha e trilha) ou manter só o registro versionado como exceção',
    tipo: 'lista',
    padrao: 'tela',
    opcoes: ['tela', 'excecao'],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Dono do projeto',
    origem: 'W0-09 (programa CRUD completo): D-RETRO-REGISTRO-F6, os dois caminhos construídos',
  },
];
