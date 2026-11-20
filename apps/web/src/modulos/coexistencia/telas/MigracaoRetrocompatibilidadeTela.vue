<script setup lang="ts">
// Migração gradual: a retrocompatibilidade do banco (M59, etapa 6; ficha do M59, seção 1, regras 1, 6, 11 e 12 e
// seção 5 "estado esperado"; ADR 0033). Só leitura: as quatro condições para extinguir com a data de cada uma, a
// decisão registrada e a que vale (uma extinção sem as condições vale mantida e diz o que falta), os cinco passos do
// plano de evolução com o tamanho medido no banco, a ficha e o que falta, o estado esperado das retiradas e as medidas
// da estrutura do banco. A decisão e os passos mudam pelo registro gravado nesta tela (com motivo e senha) ou, se o
// parâmetro coexistencia.registro.modo registrar a exceção, só pelo registro versionado (D-RETRO-REGISTRO-F6, W0-09).
import type { PainelRetrocompatibilidade } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { chaveOperacao, lerRetrocompatibilidade } from '../api-retrocompatibilidade.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import RegistroCoexEditor from '../componentes/RegistroCoexEditor.vue';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['coexistencia', 'retrocompatibilidade'],
  queryFn: lerRetrocompatibilidade,
});
const painel = computed<PainelRetrocompatibilidade | undefined>(() => consulta.data.value);
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');
const numero = (n: number) => n.toLocaleString('pt-BR');
const faltam = computed(() =>
  (painel.value?.extincaoSemCondicoes ?? [])
    .map((c) => t(`retrocompatibilidade.condicoes.nomes.${c}.titulo`))
    .join('; '),
);
/** As retiradas em que o catálogo de operações não acompanha a decisão (ou não pôde ser lido). */
const retiradasDivergentes = computed(() =>
  (painel.value?.operacoesDeRetirada ?? []).filter((o) => o.divergente),
);
</script>

<template>
  <section class="tela" aria-labelledby="retro-titulo">
    <h1 id="retro-titulo">{{ t('retrocompatibilidade.titulo') }}</h1>
    <AbasMigracao atual="retrocompatibilidade" />
    <p>{{ t('retrocompatibilidade.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('retrocompatibilidade.carregando') }}</p>
    <template v-else-if="painel">
      <ul class="cabecalho" data-testid="retro-cabecalho">
        <li>{{ t('retrocompatibilidade.hospital', { hospital: painel.hospital }) }}</li>
        <li>{{ t('retrocompatibilidade.medidoEm', { em: instante(painel.em) }) }}</li>
        <li data-testid="retro-adr">
          {{ t('retrocompatibilidade.adr', { numero: painel.adr.numero }) }}:
          <code>{{ painel.adr.caminho }}</code>
        </li>
        <li data-testid="retro-registro">
          {{ t('retrocompatibilidade.registro', { caminho: painel.registro }) }}
        </li>
      </ul>
      <SanteAlerta
        v-if="painel.registroInvalido"
        :texto="t('retrocompatibilidade.registroInvalido', { motivo: painel.registroInvalido })"
        variante="alerta"
        data-testid="retro-registro-invalido"
      />

      <!-- A decisão (regra 11): a registrada e a que vale -->
      <h2>{{ t('retrocompatibilidade.decisao.titulo') }}</h2>
      <dl class="decisao" data-testid="retro-decisao">
        <dt>{{ t('retrocompatibilidade.decisao.registrada') }}</dt>
        <dd data-testid="retro-decisao-registrada">
          {{ t(`retrocompatibilidade.decisao.nomes.${painel.decisaoRegistrada}`) }}
        </dd>
        <dt>{{ t('retrocompatibilidade.decisao.vigente') }}</dt>
        <dd data-testid="retro-decisao-vigente">
          <strong>{{ t(`retrocompatibilidade.decisao.nomes.${painel.decisaoVigente}`) }}</strong>
        </dd>
        <dt>{{ t('retrocompatibilidade.decisao.decididaEm') }}</dt>
        <dd>{{ dia(painel.decididaEm) }}</dd>
        <dt>{{ t('retrocompatibilidade.decisao.referencia') }}</dt>
        <dd>{{ painel.referencia ?? t('retrocompatibilidade.decisao.nenhuma') }}</dd>
        <dt>{{ t('retrocompatibilidade.decisao.contingenciaLonga') }}</dt>
        <dd data-testid="retro-contingencia-longa">
          {{
            painel.contingenciaLonga
              ? t('retrocompatibilidade.decisao.sim')
              : t('retrocompatibilidade.decisao.nao')
          }}
        </dd>
        <dt>{{ t('retrocompatibilidade.decisao.revisarEm') }}</dt>
        <dd>{{ dia(painel.revisarEm) }}</dd>
      </dl>
      <SanteAlerta
        v-if="painel.extincaoSemCondicoes.length > 0"
        :texto="t('retrocompatibilidade.decisao.extincaoSemCondicoes', { faltam })"
        variante="alerta"
        data-testid="retro-extincao-sem-condicoes"
      />
      <p data-testid="retro-pode-decidir">
        {{
          painel.podeDecidirExtincao
            ? t('retrocompatibilidade.decisao.podeDecidir')
            : t('retrocompatibilidade.decisao.naoPodeDecidir')
        }}
      </p>

      <!-- As quatro condições (regra 11; regra 1 e DP-6) -->
      <h2>{{ t('retrocompatibilidade.condicoes.titulo') }}</h2>
      <div
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('retrocompatibilidade.condicoes.legenda')"
      >
        <table data-testid="retro-condicoes">
          <caption>
            {{
              t('retrocompatibilidade.condicoes.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('retrocompatibilidade.condicoes.condicao') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.condicoes.situacao') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.condicoes.em') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.condicoes.fonte') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.condicoes" :key="c.condicao" :data-testid="`condicao-${c.condicao}`">
              <th scope="row">{{ t(`retrocompatibilidade.condicoes.nomes.${c.condicao}.titulo`) }}</th>
              <td>
                {{
                  c.cumprida
                    ? t('retrocompatibilidade.condicoes.cumprida')
                    : t('retrocompatibilidade.condicoes.pendente')
                }}
              </td>
              <td>{{ dia(c.em) }}</td>
              <td>{{ t(`retrocompatibilidade.condicoes.nomes.${c.condicao}.fonte`) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- O plano de evolução (regras 6 e 12): os cinco passos, na ordem -->
      <h2>{{ t('retrocompatibilidade.passos.titulo') }}</h2>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('retrocompatibilidade.passos.legenda')">
        <table data-testid="retro-passos">
          <caption>
            {{
              t('retrocompatibilidade.passos.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('retrocompatibilidade.passos.ordem') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.passo') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.tamanho') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.integracao') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.ficha') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.situacao') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.passos.motivos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in painel.passos" :key="p.passo" :data-testid="`passo-${p.passo}`">
              <td>{{ p.ordem }}</td>
              <th scope="row">
                {{ t(`retrocompatibilidade.passos.nomes.${p.passo}.titulo`) }}
                <small class="linha">{{ t(`retrocompatibilidade.passos.nomes.${p.passo}.descricao`) }}</small>
              </th>
              <td :data-testid="`passo-tamanho-${p.passo}`">
                {{
                  p.tamanho === null
                    ? t('retrocompatibilidade.passos.semMedida')
                    : `${numero(p.tamanho)} ${t(`retrocompatibilidade.passos.medidas.${p.medida}`, p.tamanho)}`
                }}
              </td>
              <td>
                {{
                  p.mudaLeituraSanteApi
                    ? t('retrocompatibilidade.passos.mudaLeitura')
                    : t('retrocompatibilidade.passos.naoMudaLeitura')
                }}
              </td>
              <td :data-testid="`passo-ficha-${p.passo}`">
                <code v-if="p.ficha">{{ p.ficha }}</code>
                <template v-else>{{ t('retrocompatibilidade.passos.semFicha') }}</template>
              </td>
              <td :data-testid="`passo-situacao-${p.passo}`">
                {{ t(`retrocompatibilidade.passos.situacoes.${p.situacao}`) }}
              </td>
              <td>
                <ul v-if="p.motivos.length > 0" class="motivos" :data-testid="`passo-motivos-${p.passo}`">
                  <li v-for="m in p.motivos" :key="m">
                    {{ t(`retrocompatibilidade.passos.motivosBloqueio.${m}`) }}
                  </li>
                </ul>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- O estado esperado das retiradas (ficha, seção 5) -->
      <h2>{{ t('retrocompatibilidade.retiradas.titulo') }}</h2>
      <p>{{ t('retrocompatibilidade.retiradas.texto') }}</p>
      <SanteAlerta
        v-if="retiradasDivergentes.length > 0"
        :texto="
          t('retrocompatibilidade.retiradas.divergencia', {
            operacoes: retiradasDivergentes
              .map((o) => t(`retrocompatibilidade.retiradas.nomes.${chaveOperacao(o.operacao)}`))
              .join('; '),
          })
        "
        variante="aviso"
        data-testid="retiradas-divergencia"
      />
      <div
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('retrocompatibilidade.retiradas.legenda')"
      >
        <table data-testid="retro-retiradas">
          <caption>
            {{
              t('retrocompatibilidade.retiradas.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('retrocompatibilidade.retiradas.operacao') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.retiradas.estado') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.retiradas.estadoAtual') }}</th>
              <th scope="col">{{ t('retrocompatibilidade.retiradas.confere') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="o in painel.operacoesDeRetirada"
              :key="o.operacao"
              :data-testid="`retirada-${chaveOperacao(o.operacao)}`"
            >
              <th scope="row">
                {{ t(`retrocompatibilidade.retiradas.nomes.${chaveOperacao(o.operacao)}`) }}
              </th>
              <td>{{ t(`retrocompatibilidade.retiradas.estados.${o.estadoEsperado}`) }}</td>
              <td :data-testid="`retirada-atual-${chaveOperacao(o.operacao)}`">
                {{
                  o.estadoAtual === null
                    ? t('retrocompatibilidade.retiradas.semLeitura')
                    : t(`retrocompatibilidade.retiradas.estadosCatalogo.${o.estadoAtual}`)
                }}
              </td>
              <td :data-testid="`retirada-confere-${chaveOperacao(o.operacao)}`">
                {{
                  o.divergente
                    ? t('retrocompatibilidade.retiradas.diverge')
                    : t('retrocompatibilidade.retiradas.sim')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- As medidas da estrutura do banco (o tamanho dos passos) -->
      <h2>{{ t('retrocompatibilidade.inventario.titulo') }}</h2>
      <p>{{ t('retrocompatibilidade.inventario.texto') }}</p>
      <SanteAlerta
        v-if="painel.inventarioIndisponivel"
        :texto="t('retrocompatibilidade.inventario.indisponivel')"
        variante="aviso"
        data-testid="retro-inventario-indisponivel"
      />
      <template v-if="painel.inventario">
        <p v-if="painel.inventarioMedidoEm">
          {{ t('retrocompatibilidade.inventario.medidoEm', { em: instante(painel.inventarioMedidoEm) }) }}
        </p>
        <ul class="inventario" data-testid="retro-inventario">
          <li>{{ t('retrocompatibilidade.inventario.tabelas') }}: {{ numero(painel.inventario.tabelas) }}</li>
          <li>
            {{
              t('retrocompatibilidade.inventario.tabelasClinicas', {
                presentes: numero(painel.inventario.tabelasClinicas.presentes),
                matriz: numero(painel.inventario.tabelasClinicas.matriz),
              })
            }}
          </li>
          <li>
            {{
              t('retrocompatibilidade.inventario.gatilhos', {
                total: numero(painel.inventario.gatilhos.total),
                ativos: numero(painel.inventario.gatilhos.ativos),
                tabelas: numero(painel.inventario.gatilhos.tabelas),
              })
            }}
          </li>
          <li>
            {{
              t('retrocompatibilidade.inventario.colunasDeUmaLetra', {
                colunas: numero(painel.inventario.colunasDeUmaLetra.colunas),
                tabelas: numero(painel.inventario.colunasDeUmaLetra.tabelas),
              })
            }}
          </li>
          <li>
            {{
              t('retrocompatibilidade.inventario.paresDataHora', {
                pares: numero(painel.inventario.paresDataHora.pares),
                tabelas: numero(painel.inventario.paresDataHora.tabelas),
              })
            }}
          </li>
          <li>
            {{
              t('retrocompatibilidade.inventario.chavesEmTexto', {
                chaves: numero(painel.inventario.chavesEmTexto.chaves),
                deTotal: numero(painel.inventario.chavesEmTexto.deTotal),
                tabelas: numero(painel.inventario.chavesEmTexto.tabelas),
              })
            }}
          </li>
          <li data-testid="retro-gatilhos-sgh">
            {{
              t('retrocompatibilidade.inventario.gatilhosSgh', {
                n: numero(painel.inventario.gatilhosSghEmTabelaLegada),
              })
            }}
          </li>
        </ul>
        <SanteAlerta
          v-if="painel.inventario.gatilhosSghEmTabelaLegada > 0"
          :texto="t('retrocompatibilidade.inventario.gatilhosSghAlerta')"
          variante="alerta"
          data-testid="retro-gatilhos-sgh-alerta"
        />
      </template>
    </template>
    <RegistroCoexEditor tipo="retrocompatibilidade" />
  </section>
</template>

<style scoped>
.cabecalho,
.inventario {
  margin: var(--sgh-espaco-2) 0;
}
.decisao {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: var(--sgh-espaco-2) 0;
}
.decisao dd {
  margin: 0;
}
.linha {
  display: block;
  font-weight: 400;
  color: var(--sgh-texto-secundario);
}
.motivos {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
</style>
