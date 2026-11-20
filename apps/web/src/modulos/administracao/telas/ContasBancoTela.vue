<script setup lang="ts">
// "Contas do banco de dados e privilégios" (M59-F1, ficha seções 7 e 8, regras 4 e 5; cap-08 §8.10): o inventário
// das contas que acessam o banco (função, privilégios em contagens, uso medido, destino e situação, com o motivo) e,
// na aba Desvios, o plano do privilégio mínimo por módulo comparado ao catálogo de segurança. Só consulta: a
// revogação é script da TI, com autorização do dono por passo; nenhum botão aqui altera conta. As contas fora do
// catálogo vêm somadas, sem nome (podem ser login de pessoa). M59-F3: a aba Registros clínicos mostra a
// imutabilidade imposta no banco (quem ainda pode apagar registro clínico, o plano e as operações do Sante).
import {
  CLASSES_CONTA_BANCO,
  type ClasseContaBanco,
  DESTINOS_CONTA_BANCO,
  type DestinoContaBanco,
  type LinhaContaBanco,
  SITUACOES_CONTA_BANCO,
  type SituacaoContaBanco,
} from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarImutabilidade } from '../../acesso/api-segredos.js';
import { buscarContasBanco, buscarDesviosPrivilegios } from '../api.js';

const { t } = useI18n();
const P = 'adm.contasBanco';
const aba = ref<'inventario' | 'desvios' | 'imutabilidade'>('inventario');
const inventario = useQuery({ queryKey: ['adm', 'contas-banco'], queryFn: () => buscarContasBanco() });
const desvios = useQuery({
  queryKey: ['adm', 'contas-banco', 'desvios'],
  queryFn: () => buscarDesviosPrivilegios(),
  enabled: computed(() => aba.value === 'desvios'),
});
const imutabilidade = useQuery({
  queryKey: ['adm', 'contas-banco', 'imutabilidade'],
  queryFn: () => buscarImutabilidade(),
  enabled: computed(() => aba.value === 'imutabilidade'),
});
const I = 'segredos.imutabilidade';

const busca = ref('');
const classe = ref<ClasseContaBanco | ''>('');
const destino = ref<DestinoContaBanco | ''>('');
const situacao = ref<SituacaoContaBanco | ''>('');

const opcoesClasse = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.filtros.todas`) },
  ...CLASSES_CONTA_BANCO.map((c) => ({ valor: c, rotulo: t(`${P}.classes.${c}`) })),
]);
const opcoesDestino = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.filtros.todos`) },
  ...DESTINOS_CONTA_BANCO.map((d) => ({ valor: d, rotulo: t(`${P}.destinos.${d}`) })),
]);
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.filtros.todas`) },
  ...SITUACOES_CONTA_BANCO.map((s) => ({ valor: s, rotulo: t(`${P}.situacoes.${s}`) })),
]);

/** Sem acento e sem caixa, por palavras em qualquer ordem (como a busca dos combos). */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nomeDaConta = (c: LinhaContaBanco) => c.nome ?? t(`${P}.demaisContas`);

const contas = computed(() => inventario.data.value?.contas ?? []);
const filtradas = computed(() => {
  const palavras = normalizar(busca.value).split(/\s+/).filter(Boolean);
  return contas.value.filter((c) => {
    if (classe.value && c.classe !== classe.value) return false;
    if (destino.value && c.destino !== destino.value) return false;
    if (situacao.value && c.situacao !== situacao.value) return false;
    if (palavras.length === 0) return true;
    const alvo = normalizar([nomeDaConta(c), t(`${P}.classes.${c.classe}`), ...c.papeis, c.motivo].join(' '));
    return palavras.every((p) => alvo.includes(p));
  });
});
const comFiltro = computed(() => !!(busca.value || classe.value || destino.value || situacao.value));
function limparFiltros(): void {
  busca.value = '';
  classe.value = '';
  destino.value = '';
  situacao.value = '';
}

const situacoesComConta = computed(() => {
  const por: Partial<Record<SituacaoContaBanco, number>> = inventario.data.value?.resumo.porSituacao ?? {};
  return SITUACOES_CONTA_BANCO.filter((s) => (por[s] ?? 0) > 0).map((s) => ({ s, n: por[s] ?? 0 }));
});

const fmtEm = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const fmtDia = (iso: string) => iso.split('-').reverse().join('/');
const fmtNum = (n: number | '<5') => (n === '<5' ? n : n.toLocaleString('pt-BR'));
function descricaoConta(c: LinhaContaBanco): string {
  const partes: string[] = [];
  if (c.tipo === 'papel') partes.push(t(`${P}.papel`));
  else if (!c.existeLogin) partes.push(t(`${P}.semLogin`));
  else if (c.ativa !== null) partes.push(t(c.ativa ? `${P}.ativa` : `${P}.inativa`));
  if (c.nome === null) partes.push(String(fmtNum(c.quantidade)));
  return partes.join(' · ');
}
function usoDaConta(c: LinhaContaBanco): string {
  if (!c.uso) return t(`${P}.semMedicao`);
  return t(`${P}.usoJanela`, {
    sessoes: fmtNum(c.uso.sessoes),
    inicio: fmtDia(c.uso.inicio),
    fim: fmtDia(c.uso.fim),
  });
}
</script>

<template>
  <section class="tela" aria-labelledby="contas-banco-titulo" data-testid="tela-contas-banco">
    <h1 id="contas-banco-titulo">{{ t(`${P}.titulo`) }}</h1>
    <p>{{ t(`${P}.texto`) }}</p>
    <SanteAlerta :texto="t(`${P}.somenteConsulta`)" variante="info" />

    <div class="abas" role="tablist">
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'inventario'"
        variante="secundario"
        :rotulo="t(`${P}.abas.inventario`)"
        data-testid="contas-aba-inventario"
        @acionar="aba = 'inventario'"
      />
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'desvios'"
        variante="secundario"
        :rotulo="t(`${P}.abas.desvios`)"
        data-testid="contas-aba-desvios"
        @acionar="aba = 'desvios'"
      />
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'imutabilidade'"
        variante="secundario"
        :rotulo="t(`${I}.aba`)"
        data-testid="contas-aba-imutabilidade"
        @acionar="aba = 'imutabilidade'"
      />
    </div>

    <!-- ── Contas ── -->
    <div v-if="aba === 'inventario'" role="tabpanel" data-testid="painel-inventario">
      <MensagemErro v-if="inventario.isError.value" :erro="inventario.error.value" />
      <p v-else-if="inventario.isPending.value">{{ t('adm.comum.carregando') }}</p>
      <template v-else-if="inventario.data.value">
        <p class="discreto">
          {{ t(`${P}.hospital`, { h: inventario.data.value.hospital, em: fmtEm(inventario.data.value.em) }) }}
        </p>

        <section class="bloco" aria-labelledby="contas-contexto" data-testid="contas-contexto">
          <h2 id="contas-contexto">{{ t(`${P}.contexto.titulo`) }}</h2>
          <ul>
            <li>
              {{
                inventario.data.value.contexto.desligado
                  ? t(`${P}.contexto.desligado`)
                  : t(`${P}.contexto.naoDesligado`)
              }}
            </li>
            <li>
              {{
                inventario.data.value.contexto.contingenciaAtiva
                  ? t(`${P}.contexto.contingenciaAtiva`)
                  : t(`${P}.contexto.contingenciaEncerrada`)
              }}
            </li>
            <li>{{ t(`${P}.contexto.janela`, { n: inventario.data.value.contexto.janelaMinimaDias }) }}</li>
          </ul>
          <template v-if="inventario.data.value.contexto.avisos.length > 0">
            <h3>{{ t(`${P}.contexto.avisos`) }}</h3>
            <ul data-testid="contas-avisos">
              <li v-for="a in inventario.data.value.contexto.avisos" :key="a">{{ a }}</li>
            </ul>
          </template>
        </section>

        <dl class="resumo" data-testid="contas-resumo">
          <div>
            <dt>{{ t(`${P}.resumo.comPrivilegio`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.contasComPrivilegio) }}</dd>
          </div>
          <div>
            <dt>{{ t(`${P}.resumo.comEscrita`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.contasComEscrita) }}</dd>
          </div>
          <div>
            <dt>{{ t(`${P}.resumo.comEscritaAmpla`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.contasComEscritaAmpla) }}</dd>
          </div>
          <div>
            <dt>{{ t(`${P}.resumo.maiorAlcance`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.maiorAlcanceEscrita) }}</dd>
          </div>
          <div>
            <dt>{{ t(`${P}.resumo.naoCatalogadas`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.naoCatalogadas) }}</dd>
          </div>
          <div>
            <dt>{{ t(`${P}.loginsSemPrivilegio`) }}</dt>
            <dd>{{ fmtNum(inventario.data.value.resumo.loginsSemPrivilegio) }}</dd>
          </div>
        </dl>
        <p v-if="inventario.data.value.resumo.papeisSemPrivilegio.length > 0" class="discreto">
          {{
            t(`${P}.papeisSemPrivilegio`, {
              lista: inventario.data.value.resumo.papeisSemPrivilegio.join(', '),
            })
          }}
        </p>
        <p v-if="situacoesComConta.length > 0" data-testid="contas-por-situacao">
          <strong>{{ t(`${P}.porSituacao`) }}:</strong>
          <span v-for="(x, i) in situacoesComConta" :key="x.s">
            {{ i > 0 ? ' · ' : ' ' }}{{ t(`${P}.situacoes.${x.s}`) }}: {{ x.n }}
          </span>
        </p>

        <form class="filtros" :aria-label="t(`${P}.filtros.titulo`)" @submit.prevent>
          <SanteCampoTexto
            id="contas-busca"
            v-model="busca"
            :rotulo="t(`${P}.filtros.busca`)"
            :max-bytes="63"
            data-testid="contas-busca"
          />
          <SanteSelecao
            id="contas-classe"
            v-model="classe"
            :rotulo="t(`${P}.filtros.classe`)"
            :opcoes="opcoesClasse"
            data-testid="contas-filtro-classe"
          />
          <SanteSelecao
            id="contas-destino"
            v-model="destino"
            :rotulo="t(`${P}.filtros.destino`)"
            :opcoes="opcoesDestino"
            data-testid="contas-filtro-destino"
          />
          <SanteSelecao
            id="contas-situacao"
            v-model="situacao"
            :rotulo="t(`${P}.filtros.situacao`)"
            :opcoes="opcoesSituacao"
            data-testid="contas-filtro-situacao"
          />
          <SanteBotao
            v-if="comFiltro"
            :rotulo="t(`${P}.filtros.limpar`)"
            variante="texto"
            data-testid="contas-limpar"
            @acionar="limparFiltros"
          />
        </form>
        <p role="status" data-testid="contas-contagem">
          {{ t(`${P}.contagem`, { n: filtradas.length, total: contas.length }) }}
        </p>

        <p v-if="filtradas.length === 0" data-testid="contas-vazio">{{ t(`${P}.nenhumaConta`) }}</p>
        <div v-else class="rolagem">
          <table data-testid="tabela-contas">
            <caption class="oculto">
              {{
                t(`${P}.titulo`)
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t(`${P}.colunas.conta`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.classe`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunas.leitura`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunas.escrita`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunas.execucao`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.papeis`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.uso`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.destino`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.situacao`) }}</th>
                <th scope="col">{{ t(`${P}.colunas.motivo`) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in filtradas"
                :key="c.nome ?? `__demais-${c.tipo}`"
                :data-testid="`conta-${c.nome ?? 'demais'}`"
              >
                <th scope="row">
                  {{ nomeDaConta(c) }}
                  <span v-if="descricaoConta(c)" class="discreto"> ({{ descricaoConta(c) }})</span>
                </th>
                <td>{{ t(`${P}.classes.${c.classe}`) }}</td>
                <td class="num">{{ fmtNum(c.leitura) }}</td>
                <td class="num">{{ fmtNum(c.escrita) }}</td>
                <td class="num">{{ fmtNum(c.execucao) }}</td>
                <td>{{ c.papeis.length > 0 ? c.papeis.join(', ') : '—' }}</td>
                <td>{{ usoDaConta(c) }}</td>
                <td>{{ t(`${P}.destinos.${c.destino}`) }}</td>
                <td>{{ t(`${P}.situacoes.${c.situacao}`) }}</td>
                <td>{{ c.motivo }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- ── Registros clínicos (imutabilidade) ── -->
    <div v-else-if="aba === 'imutabilidade'" role="tabpanel" data-testid="painel-imutabilidade">
      <h2>{{ t(`${I}.titulo`) }}</h2>
      <p>{{ t(`${I}.texto`) }}</p>
      <MensagemErro v-if="imutabilidade.isError.value" :erro="imutabilidade.error.value" />
      <p v-else-if="imutabilidade.isPending.value">{{ t('adm.comum.carregando') }}</p>
      <template v-else-if="imutabilidade.data.value">
        <p class="discreto">
          {{
            t(`${P}.hospital`, {
              h: imutabilidade.data.value.hospital,
              em: fmtEm(imutabilidade.data.value.em),
            })
          }}
        </p>
        <p data-testid="imutabilidade-tabelas">
          {{
            t(`${I}.tabelas`, {
              prontuario: fmtNum(imutabilidade.data.value.tabelasClinicas.legado),
              sante: fmtNum(imutabilidade.data.value.tabelasClinicas.sgh),
            })
          }}
        </p>
        <SanteAlerta
          :texto="
            imutabilidade.data.value.concessaoVigente
              ? t(`${I}.concessaoVigente`)
              : t(`${I}.concessaoEncerrada`)
          "
          :variante="imutabilidade.data.value.concessaoVigente ? 'aviso' : 'info'"
          data-testid="imutabilidade-concessao"
        />

        <h3>{{ t(`${I}.titulares`) }}</h3>
        <p
          v-if="imutabilidade.data.value.titulares.length === 0"
          data-testid="imutabilidade-titulares-nenhum"
        >
          {{ t(`${I}.titularesNenhum`) }}
        </p>
        <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t(`${I}.titulares`)">
          <table data-testid="imutabilidade-titulares">
            <caption>
              {{
                t(`${I}.titulares`)
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t(`${I}.colunas.titular`) }}</th>
                <th scope="col">{{ t(`${I}.colunas.doSante`) }}</th>
                <th scope="col" class="num">{{ t(`${I}.colunas.tabelas`) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in imutabilidade.data.value.titulares" :key="x.titular">
                <th scope="row">{{ x.titular === '(outras)' ? t(`${I}.outras`) : x.titular }}</th>
                <td>{{ x.doSante ? t('segredos.comum.sim') : t('segredos.comum.nao') }}</td>
                <td class="num">{{ fmtNum(x.tabelas) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>{{ t(`${I}.plano`) }}</h3>
        <p data-testid="imutabilidade-plano">
          {{
            imutabilidade.data.value.planoComDelete === 0
              ? t(`${I}.planoNenhum`)
              : t(`${I}.planoAlguns`, { n: fmtNum(imutabilidade.data.value.planoComDelete) })
          }}
        </p>

        <h3>{{ t(`${I}.operacoes`) }}</h3>
        <p
          v-if="imutabilidade.data.value.operacoesComDelete.length === 0"
          data-testid="imutabilidade-operacoes-nenhuma"
        >
          {{ t(`${I}.operacoesNenhuma`) }}
        </p>
        <ul v-else data-testid="imutabilidade-operacoes">
          <li v-for="o in imutabilidade.data.value.operacoesComDelete" :key="`${o.operacao}|${o.tabela}`">
            {{ o.operacao }} · {{ o.tabela }}
          </li>
        </ul>

        <template v-if="imutabilidade.data.value.excecoes.length">
          <h3>{{ t(`${I}.excecoes`) }}</h3>
          <dl data-testid="imutabilidade-excecoes">
            <template v-for="e in imutabilidade.data.value.excecoes" :key="e.tabela">
              <dt>{{ e.tabela }}</dt>
              <dd>{{ e.motivo }}</dd>
            </template>
          </dl>
        </template>
      </template>
    </div>

    <!-- ── Desvios ── -->
    <div v-else role="tabpanel" data-testid="painel-desvios">
      <h2>{{ t(`${P}.desvios.titulo`) }}</h2>
      <MensagemErro v-if="desvios.isError.value" :erro="desvios.error.value" />
      <p v-else-if="desvios.isPending.value">{{ t('adm.comum.carregando') }}</p>
      <template v-else-if="desvios.data.value">
        <p class="discreto">
          {{ t(`${P}.hospital`, { h: desvios.data.value.hospital, em: fmtEm(desvios.data.value.em) }) }} ·
          {{ t(`${P}.desvios.versao`, { v: desvios.data.value.versaoPlano }) }}
        </p>
        <SanteAlerta
          v-if="!desvios.data.value.planoAplicado"
          :texto="t(`${P}.desvios.planoNaoAplicado`)"
          variante="aviso"
          data-testid="desvios-nao-aplicado"
        />
        <p role="status" data-testid="desvios-totais">
          {{ t(`${P}.desvios.iguais`, { n: fmtNum(desvios.data.value.iguais) }) }} ·
          {{ t(`${P}.desvios.totalExcesso`, { n: fmtNum(desvios.data.value.excessoTotal) }) }} ·
          {{ t(`${P}.desvios.totalFalta`, { n: fmtNum(desvios.data.value.faltaTotal) }) }}
        </p>

        <h3>{{ t(`${P}.desvios.modulos`) }}</h3>
        <div class="rolagem">
          <table data-testid="tabela-modulos">
            <caption class="oculto">
              {{
                t(`${P}.desvios.modulos`)
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t(`${P}.desvios.colunas.modulo`) }}</th>
                <th scope="col">{{ t(`${P}.desvios.colunas.papel`) }}</th>
                <th scope="col">{{ t(`${P}.desvios.colunas.conta`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.desvios.colunas.objetos`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.desvios.colunas.itens`) }}</th>
                <th scope="col">{{ t(`${P}.desvios.colunas.configurada`) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in desvios.data.value.modulos" :key="m.modulo">
                <th scope="row">{{ m.modulo }}</th>
                <td>{{ m.papel }}</td>
                <td>{{ m.conta }}</td>
                <td class="num">{{ fmtNum(m.objetos) }}</td>
                <td class="num">{{ fmtNum(m.itens) }}</td>
                <td>{{ m.contaConfigurada ? t(`${P}.sim`) : t(`${P}.nao`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-for="lista in ['excesso', 'falta'] as const" :key="lista">
          <h3>{{ t(`${P}.desvios.${lista}`) }}</h3>
          <p v-if="desvios.data.value[lista].length === 0" :data-testid="`desvios-${lista}-nenhum`">
            {{ t(`${P}.desvios.nenhum`) }}
          </p>
          <template v-else>
            <p v-if="desvios.data.value[lista].length < desvios.data.value[`${lista}Total`]" class="discreto">
              {{
                t(`${P}.desvios.mostrando`, {
                  n: fmtNum(desvios.data.value[lista].length),
                  total: fmtNum(desvios.data.value[`${lista}Total`]),
                })
              }}
            </p>
            <div class="rolagem">
              <table :data-testid="`tabela-${lista}`">
                <caption class="oculto">
                  {{
                    t(`${P}.desvios.${lista}`)
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t(`${P}.desvios.colunas.titular`) }}</th>
                    <th scope="col">{{ t(`${P}.desvios.colunas.objeto`) }}</th>
                    <th scope="col">{{ t(`${P}.desvios.colunas.acao`) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in desvios.data.value[lista]" :key="`${d.titular}|${d.objeto}|${d.acao}`">
                    <th scope="row">{{ d.titular }}</th>
                    <td>{{ d.objeto }}</td>
                    <td>{{ d.acao }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-2) 0;
}
.resumo {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.resumo > div {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.resumo dt {
  font-size: 0.875rem;
}
.resumo dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.num {
  text-align: right;
}
.discreto {
  font-size: 0.875rem;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
