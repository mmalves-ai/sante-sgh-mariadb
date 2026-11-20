<script setup lang="ts">
// Manipulação e capelas (M46, etapa 4; ficha, seção 7; regra 11; operações suprimentos.abrirOrdemManipulacao,
// suprimentos.conferirManipulacao e a baixa do insumo por suprimentos.registrarSaida). Três abas:
//   - Itens a manipular: os itens prescritos validados pela farmácia (pela regra automática ou pelo farmacêutico), com
//     o leito e as iniciais; "Abrir a ordem" com a capela e o grupo, o insumo do estoque com o lote (o do local, quando o
//     item é rastreado), a quantidade, a dose e a validade da sobra pela regra versionada;
//   - Ordens de manipulação: as ordens do período com a situação; a dupla conferência (aprovada ou reprovada, por outro
//     farmacêutico) e a baixa do insumo (a saída do estoque ao paciente internado com o centro de custo da unidade);
//   - Capelas e grupos: o cadastro em consulta (a edição liberada a pedido da farmácia).
// O servidor confere tudo de novo.
import type { ItemAManipular, OrdemManipulacao, SaldoItem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirOrdemManipulacao,
  baixarOrdemManipulacao,
  buscarInsumosManipulacao,
  conferirOrdemManipulacao,
  lerInsumoManipulacao,
  lerPainelManipulacao,
} from '../api-consignado.js';
import BuscaCodigoNome from '../componentes/BuscaCodigoNome.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import './estilo-opme.css';

type Aba = 'itens' | 'ordens' | 'capelas';
const { t } = useI18n();
const aba = ref<Aba>('itens');
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
const ate = ref(hoje);
const painel = useQuery({
  queryKey: computed(() => ['manipulacao', de.value, ate.value]),
  queryFn: () => lerPainelManipulacao(de.value || null, ate.value || null),
});
const dados = computed(() => painel.data.value ?? null);
const pode = (op: string) => dados.value?.gravacao.operacoes[op]?.pode === true;
const erro = ref<unknown>(null);
const mensagem = ref('');
const enviando = ref(false);
const diaHora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const dia = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
const num = (n: number) => String(n).replace('.', ',');

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await painel.refetch();
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    enviando.value = false;
  }
}

// ── Abrir a ordem ───────────────────────────────────────────────────────────────────────────────────────────

const item = ref<ItemAManipular | null>(null);
const form = reactive({
  capela: null as number | null,
  grupo: null as number | null,
  local: null as number | null,
  insumo: null as number | null,
  lote: null as string | null,
  loteDigitado: '',
  validadeDigitada: '',
  quantidade: 1,
  dose: '',
  sobra: '',
});
const saldo = ref<SaldoItem | null>(null);
const opcoesCapela = computed(() =>
  (dados.value?.capelas ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: c.funcionando ? c.nome : t('manipulacao.form.paradaRotulo', { nome: c.nome }),
  })),
);
const opcoesGrupo = computed(() => [
  { valor: null as number | null, rotulo: t('manipulacao.form.semGrupo') },
  ...(dados.value?.capelas.find((c) => c.id === form.capela)?.grupos ?? []).map((g) => ({
    valor: g.id as number | null,
    rotulo: g.nome,
  })),
]);
const opcoesLocal = computed(() =>
  (dados.value?.locais ?? []).map((l) => ({ valor: l.codigo as number | null, rotulo: l.nome })),
);
const opcoesLote = computed(() =>
  (saldo.value?.lotes ?? []).map((l) => ({
    valor: `${l.lote}|${l.validade}` as string | null,
    rotulo: `${l.lote} · ${dia(l.validade)} (${num(l.quantidade)})`,
  })),
);
watch(
  () => form.capela,
  () => {
    form.grupo = null;
  },
);
watch([() => form.insumo, () => form.local], async ([i, l]) => {
  saldo.value = null;
  form.lote = null;
  if (i === null || l === null) return;
  try {
    saldo.value = (await lerInsumoManipulacao(i, l)).saldo;
  } catch (e) {
    erro.value = e;
  }
});
const buscarInsumo = async (termo: string) => {
  const r = await buscarInsumosManipulacao(termo);
  return { itens: r.itens.map((i) => ({ codigo: i.codigo, nome: i.nome, detalhe: i.unidade })) };
};
function escolher(i: ItemAManipular): void {
  item.value = i;
  Object.assign(form, {
    capela: dados.value?.capelas.find((c) => c.funcionando)?.id ?? null,
    grupo: null,
    local: dados.value?.locais[0]?.codigo ?? null,
    insumo: null,
    lote: null,
    loteDigitado: '',
    validadeDigitada: '',
    quantidade: 1,
    dose: '',
    sobra: '',
  });
}
async function abrir(): Promise<void> {
  const i = item.value;
  if (!i || form.capela === null || form.insumo === null || form.local === null) return;
  const [lote, validade] = saldo.value?.rastreavel
    ? ((form.lote ?? '|').split('|') as [string, string])
    : [form.loteDigitado.trim(), form.validadeDigitada];
  const ok = await executar(() =>
    abrirOrdemManipulacao({
      itemPrescrito: i.itemPrescrito,
      capela: form.capela,
      grupo: form.grupo,
      insumo: form.insumo,
      local: form.local,
      loteInsumo: lote,
      validadeInsumo: validade,
      quantidade: Number(form.quantidade),
      dose: form.dose.trim() || null,
      validadeSobra: form.sobra || null,
    }),
  );
  if (ok) {
    item.value = null;
    aba.value = 'ordens';
  }
}

// ── Conferência e baixa ─────────────────────────────────────────────────────────────────────────────────────

const conferindo = ref<OrdemManipulacao | null>(null);
const conf = reactive({ resultado: 'aprovada' as 'aprovada' | 'reprovada', observacao: '' });
async function conferir(): Promise<void> {
  const o = conferindo.value;
  if (!o) return;
  const ok = await executar(() =>
    conferirOrdemManipulacao(o.id, {
      versaoVista: o.versao,
      resultado: conf.resultado,
      observacao: conf.observacao.trim() || null,
    }),
  );
  if (ok) {
    conferindo.value = null;
    Object.assign(conf, { resultado: 'aprovada', observacao: '' });
  }
}
const baixando = ref<OrdemManipulacao | null>(null);
const centro = ref<number | null>(null);
const opcoesCentro = computed(() =>
  (dados.value?.centros ?? []).map((c) => ({
    valor: c.codigo as number | null,
    rotulo: `${c.codigo} · ${c.nome}`,
  })),
);
async function baixar(): Promise<void> {
  const o = baixando.value;
  if (!o || centro.value === null) return;
  const ok = await executar(() =>
    baixarOrdemManipulacao(o.id, { versaoVista: o.versao, centroCusto: centro.value }),
  );
  if (ok) {
    baixando.value = null;
    centro.value = null;
  }
}
const abas: Aba[] = ['itens', 'ordens', 'capelas'];
const consultaCapelas = '/consultas/item/suprimentos.farmacia-hospitalar.manipulacao-e-capelas';
</script>

<template>
  <section class="tela-opme" aria-labelledby="manip-titulo" data-testid="tela-manipulacao">
    <h1 id="manip-titulo">{{ t('manipulacao.titulo') }}</h1>
    <div class="abas" role="tablist">
      <SanteBotao
        v-for="a in abas"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="t(`manipulacao.abas.${a}`)"
        :data-testid="`manip-aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="manip-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!dados" role="status">{{ t('manipulacao.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!dados.gravacao.ligada"
        variante="aviso"
        :texto="dados.gravacao.motivo ?? t('manipulacao.emConsulta')"
        data-testid="manip-desligado"
      />
      <p v-if="dados.cortada" class="secundario">{{ t('manipulacao.cortada') }}</p>

      <!-- Itens a manipular -->
      <template v-if="aba === 'itens'">
        <p v-if="dados.itens.length === 0">{{ t('manipulacao.itens.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <caption class="secundario">
              {{
                t('manipulacao.itens.legenda')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('manipulacao.itens.colLeito') }}</th>
                <th scope="col">{{ t('manipulacao.itens.colPaciente') }}</th>
                <th scope="col">{{ t('manipulacao.itens.colAtendimento') }}</th>
                <th scope="col">{{ t('manipulacao.itens.colProduto') }}</th>
                <th scope="col">{{ t('manipulacao.itens.colValidado') }}</th>
                <th scope="col">{{ t('manipulacao.itens.colAcao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="i in dados.itens"
                :key="i.itemPrescrito"
                :data-testid="`manip-item-${i.itemPrescrito}`"
              >
                <td>{{ i.leito ?? '—' }}</td>
                <td>{{ i.iniciais ?? '—' }}</td>
                <td>{{ i.atendimento }}</td>
                <td>{{ i.produto ?? '—' }} · {{ i.produtoNome ?? '—' }}</td>
                <td>
                  {{ diaHora(i.validadoEm) }} ·
                  {{
                    i.validadoPor
                      ? t('manipulacao.itens.porFarmaceutico', { quem: i.validadoPor })
                      : t('manipulacao.itens.pelaRegra')
                  }}
                </td>
                <td>
                  <span v-if="i.ordem" :data-testid="`manip-item-ordem-${i.itemPrescrito}`">
                    {{ t('manipulacao.itens.emCurso', { ordem: i.ordem }) }}
                  </span>
                  <SanteBotao
                    v-else
                    variante="secundario"
                    :rotulo="t('manipulacao.itens.abrir')"
                    :desabilitado="!pode('abrir')"
                    :data-testid="`manip-abrir-${i.itemPrescrito}`"
                    @acionar="escolher(i)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <section v-if="item" class="cartao" aria-labelledby="manip-form" data-testid="manip-form">
          <h2 id="manip-form">
            {{ t('manipulacao.form.titulo', { item: item.itemPrescrito, atendimento: item.atendimento }) }}
          </h2>
          <div class="barra">
            <SanteSelecao
              v-model="form.capela"
              :rotulo="t('manipulacao.form.capela')"
              :opcoes="opcoesCapela"
              data-testid="manip-capela"
            />
            <SanteSelecao
              v-model="form.grupo"
              :rotulo="t('manipulacao.form.grupo')"
              :opcoes="opcoesGrupo"
              data-testid="manip-grupo"
            />
            <SanteSelecao
              v-model="form.local"
              :rotulo="t('manipulacao.form.local')"
              :opcoes="opcoesLocal"
              data-testid="manip-local"
            />
          </div>
          <div class="barra">
            <BuscaCodigoNome
              v-model="form.insumo"
              :rotulo="t('manipulacao.form.insumo')"
              :rotulo-buscar="t('manipulacao.form.buscarInsumo')"
              :rotulo-escolhido="t('manipulacao.form.insumoEscolhido')"
              :rotulo-nenhum="t('manipulacao.form.insumoNenhum')"
              :buscar="buscarInsumo"
              testid="manip-insumo"
            />
          </div>
          <template v-if="form.insumo !== null && form.local !== null">
            <p v-if="saldo" role="status" data-testid="manip-saldo">
              {{ t('manipulacao.form.saldo', { saldo: num(saldo.quantidade), unidade: saldo.unidade }) }}
            </p>
            <p v-else role="status">{{ t('manipulacao.form.semSaldo') }}</p>
          </template>
          <div class="barra">
            <SanteSelecao
              v-if="saldo?.rastreavel"
              v-model="form.lote"
              :rotulo="t('manipulacao.form.lote')"
              :opcoes="opcoesLote"
              data-testid="manip-lote"
            />
            <template v-else>
              <span class="campo">
                <label for="manip-lote-digitado">{{ t('manipulacao.form.loteDigitado') }}</label>
                <input
                  id="manip-lote-digitado"
                  v-model="form.loteDigitado"
                  maxlength="30"
                  data-testid="manip-lote-digitado"
                />
              </span>
              <span class="campo">
                <label for="manip-validade">{{ t('manipulacao.form.validadeInsumo') }}</label>
                <input
                  id="manip-validade"
                  v-model="form.validadeDigitada"
                  type="date"
                  data-testid="manip-validade"
                />
              </span>
            </template>
            <span class="campo">
              <label for="manip-qtd">{{ t('manipulacao.form.quantidade') }}</label>
              <input
                id="manip-qtd"
                v-model.number="form.quantidade"
                type="number"
                min="0.001"
                step="0.001"
                data-testid="manip-qtd"
              />
            </span>
            <span class="campo">
              <label for="manip-dose">{{ t('manipulacao.form.dose') }}</label>
              <input id="manip-dose" v-model="form.dose" maxlength="60" data-testid="manip-dose" />
            </span>
            <span class="campo">
              <label for="manip-sobra">{{ t('manipulacao.form.sobra') }}</label>
              <input id="manip-sobra" v-model="form.sobra" type="datetime-local" data-testid="manip-sobra" />
            </span>
          </div>
          <p class="secundario">
            {{ t('manipulacao.form.regraSobra', { horas: dados.regraSobra.horasMaximas }) }}
          </p>
          <div class="barra">
            <SanteBotao
              :rotulo="t('manipulacao.form.abrir')"
              :desabilitado="enviando || !pode('abrir') || form.insumo === null || form.capela === null"
              data-testid="manip-abrir-gravar"
              @acionar="abrir"
            />
            <SanteBotao variante="secundario" :rotulo="t('manipulacao.cancelar')" @acionar="item = null" />
          </div>
        </section>
      </template>

      <!-- Ordens -->
      <template v-else-if="aba === 'ordens'">
        <div class="barra">
          <span class="campo">
            <label for="manip-de">{{ t('manipulacao.periodo.de') }}</label>
            <input id="manip-de" v-model="de" type="date" data-testid="manip-de" />
          </span>
          <span class="campo">
            <label for="manip-ate">{{ t('manipulacao.periodo.ate') }}</label>
            <input id="manip-ate" v-model="ate" type="date" data-testid="manip-ate" />
          </span>
        </div>
        <p v-if="dados.ordens.length === 0">{{ t('manipulacao.ordens.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ t('manipulacao.ordens.colOrdem') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colAtendimento') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colInsumo') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colCapela') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colPreparo') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colConferencia') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colSituacao') }}</th>
                <th scope="col">{{ t('manipulacao.ordens.colAcao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="o in dados.ordens"
                :key="o.id"
                :data-testid="`manip-ordem-${o.id}`"
                :data-situacao="o.situacao"
              >
                <td>{{ o.id }}</td>
                <td>{{ o.atendimento }}</td>
                <td>
                  {{ o.insumo }} · {{ o.insumoNome ?? '—' }} · {{ o.loteInsumo }} ({{
                    dia(o.validadeInsumo)
                  }}) · {{ num(o.quantidade) }}{{ o.dose ? ` · ${o.dose}` : '' }}
                  <span v-if="o.validadeSobra" class="secundario">
                    · {{ t('manipulacao.ordens.sobra', { quando: diaHora(o.validadeSobra) }) }}
                  </span>
                </td>
                <td>{{ o.capelaNome ?? o.capela }}</td>
                <td>{{ o.preparadoPor }} · {{ diaHora(o.preparadoEm) }}</td>
                <td>
                  {{ o.conferidoPor ? `${o.conferidoPor} · ${diaHora(o.conferidoEm ?? '')}` : '—' }}
                  <span v-if="o.observacao" class="secundario">· {{ o.observacao }}</span>
                </td>
                <td :data-testid="`manip-situacao-${o.id}`">
                  {{ t(`manipulacao.situacoes.${o.situacao}`) }}
                  <span v-if="o.saida" class="secundario"
                    >· {{ t('manipulacao.ordens.saida', o.saida) }}</span
                  >
                </td>
                <td>
                  <SanteBotao
                    v-if="o.situacao === 'aberta'"
                    variante="secundario"
                    :rotulo="t('manipulacao.ordens.conferir')"
                    :desabilitado="!pode('conferir')"
                    :data-testid="`manip-conferir-${o.id}`"
                    @acionar="conferindo = o"
                  />
                  <SanteBotao
                    v-else-if="o.situacao === 'conferida'"
                    variante="secundario"
                    :rotulo="t('manipulacao.ordens.baixar')"
                    :desabilitado="!pode('suprimentos.registrarSaida')"
                    :data-testid="`manip-baixar-${o.id}`"
                    @acionar="baixando = o"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <section
          v-if="conferindo"
          class="cartao"
          aria-labelledby="manip-conf"
          data-testid="manip-form-conferencia"
        >
          <h2 id="manip-conf">{{ t('manipulacao.conferencia.titulo', { ordem: conferindo.id }) }}</h2>
          <p class="secundario">{{ t('manipulacao.conferencia.ajuda') }}</p>
          <div class="barra">
            <SanteSelecao
              v-model="conf.resultado"
              :rotulo="t('manipulacao.conferencia.resultado')"
              :opcoes="[
                { valor: 'aprovada', rotulo: t('manipulacao.conferencia.aprovada') },
                { valor: 'reprovada', rotulo: t('manipulacao.conferencia.reprovada') },
              ]"
              data-testid="manip-conf-resultado"
            />
            <span class="campo">
              <label for="manip-conf-obs">{{ t('manipulacao.conferencia.observacao') }}</label>
              <input
                id="manip-conf-obs"
                v-model="conf.observacao"
                maxlength="400"
                data-testid="manip-conf-obs"
              />
            </span>
          </div>
          <div class="barra">
            <SanteBotao
              :rotulo="t('manipulacao.conferencia.gravar')"
              :desabilitado="enviando || !pode('conferir')"
              data-testid="manip-conf-gravar"
              @acionar="conferir"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('manipulacao.cancelar')"
              @acionar="conferindo = null"
            />
          </div>
        </section>

        <section v-if="baixando" class="cartao" aria-labelledby="manip-baixa" data-testid="manip-form-baixa">
          <h2 id="manip-baixa">{{ t('manipulacao.baixa.titulo', { ordem: baixando.id }) }}</h2>
          <p class="secundario">{{ t('manipulacao.baixa.ajuda') }}</p>
          <SanteSelecao
            v-model="centro"
            :rotulo="t('manipulacao.baixa.centro')"
            :opcoes="opcoesCentro"
            data-testid="manip-baixa-centro"
          />
          <div class="barra">
            <SanteBotao
              :rotulo="t('manipulacao.baixa.gravar')"
              :desabilitado="enviando || centro === null"
              data-testid="manip-baixa-gravar"
              @acionar="baixar"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('manipulacao.cancelar')"
              @acionar="baixando = null"
            />
          </div>
        </section>
      </template>

      <!-- Capelas -->
      <template v-else>
        <SanteAlerta variante="info" :texto="t('manipulacao.capelas.edicao')" />
        <p v-if="dados.capelas.length === 0">{{ t('manipulacao.capelas.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ t('manipulacao.capelas.colCapela') }}</th>
                <th scope="col">{{ t('manipulacao.capelas.colSituacao') }}</th>
                <th scope="col">{{ t('manipulacao.capelas.colGrupos') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.capelas" :key="c.id" :data-testid="`manip-capela-${c.id}`">
                <td>{{ c.id }} · {{ c.nome }}</td>
                <td>
                  {{ c.funcionando ? t('manipulacao.capelas.funcionando') : t('manipulacao.capelas.parada') }}
                  {{ c.manipulando ? `· ${t('manipulacao.capelas.emUso')}` : '' }}
                </td>
                <td>{{ c.grupos.map((g) => g.nome).join(', ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <RouterLink :to="consultaCapelas" data-testid="manip-consulta-capelas">{{
          t('manipulacao.capelas.consulta')
        }}</RouterLink>
      </template>
    </template>
  </section>
</template>
