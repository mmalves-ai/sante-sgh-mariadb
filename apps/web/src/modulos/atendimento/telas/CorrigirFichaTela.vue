<script setup lang="ts">
// Corrigir a ficha (W1-05, `atendimento.alterarAtendimento`): `/recepcao/atendimento/:reg/corrigir`. O convênio, a
// especialidade, o profissional, o procedimento, o CID, o solicitante, a observação e o caráter do atendimento aberto;
// a conta aberta acompanha (o servidor reprecifica o item da própria ficha). Só vai o que mudou, com a justificativa
// (diálogo) e o carimbo lido: a colisão com outra estação mostra o aviso e relê. Conta fechada, apresentada ou
// emitida: o servidor recusa e a tela encaminha ao faturamento.
import { type AtendimentoDetalhe, CARATERES, tipoDoProblema } from '@sgh/contratos';
import {
  SanteAlerta,
  SanteAvisoColisao,
  SanteBotao,
  SanteCampoTexto,
  SanteDialogo,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  alterarAtendimento,
  buscarCid,
  buscarProcedimentosAtendimento,
  buscarSolicitantesAtendimento,
  lerAtendimento,
  novaChave,
} from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { type CamposCorrecao, camposDaFicha, entradaDaCorrecao } from '../regras-tela.js';
import { usarAtendimento } from '../usar-atendimento.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivoAmbulatorio } = usarAtendimento();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});

const convenio = ref('');
const especialidade = ref('');
const profissional = ref('');
const procedimento = ref('');
const carater = ref<CamposCorrecao['carater']>('');
const cidPrincipal = ref<{ id: number; rotulo: string } | null>(null);
const cidSecundario = ref<{ id: number; rotulo: string } | null>(null);
const solicitante = ref<{ id: number; rotulo: string } | null>(null);
const observacao = ref('');
const antes = ref<CamposCorrecao | null>(null);
const procedimentoNome = ref('');
/** Os valores gravados que a pessoa pode retirar (mostrados como "Será retirado" quando removidos). */
const gravados = ref({ cidSecundario: '', solicitante: '', observacao: '' });

function preencher(): void {
  const f = ficha.data.value;
  const a = apoio.data.value;
  if (!f || !a) return;
  const c = camposDaFicha(f, a);
  antes.value = c;
  convenio.value = c.convenio;
  especialidade.value = c.especialidade;
  profissional.value = c.profissional;
  procedimento.value = c.procedimento;
  procedimentoNome.value = `${f.procedimento.codigo} · ${f.procedimento.nome}`;
  carater.value = c.carater;
  // O CID, o solicitante e a observação gravados aparecem; retirar envia null (a regra de tela compara com `antes`).
  const cid = (x: AtendimentoDetalhe['cidPrincipal']) =>
    x ? { id: x.id, rotulo: `${x.codigo} · ${x.nome}` } : null;
  cidPrincipal.value = cid(f.cidPrincipal);
  cidSecundario.value = cid(f.cidSecundario);
  solicitante.value = f.solicitante
    ? { id: f.solicitante.id, rotulo: `${f.solicitante.nome} · ${f.solicitante.registro}` }
    : null;
  observacao.value = c.observacao;
  gravados.value = {
    cidSecundario: cidSecundario.value?.rotulo ?? '',
    solicitante: solicitante.value?.rotulo ?? '',
    observacao: c.observacao,
  };
}
watch(() => [ficha.data.value, apoio.data.value] as const, preencher, { immediate: true });

const agora = computed<CamposCorrecao>(() => ({
  convenio: convenio.value,
  especialidade: especialidade.value,
  profissional: profissional.value,
  procedimento: procedimento.value,
  carater: carater.value,
  cidPrincipal: cidPrincipal.value?.id ?? null,
  cidSecundario: cidSecundario.value?.id ?? null,
  solicitante: solicitante.value?.id ?? null,
  observacao: observacao.value,
}));

// Listas (combos com busca: SanteSelecao).
const convenios = computed(() =>
  (apoio.data.value?.convenios ?? [])
    .filter((c) => c.aceita || String(c.codigo) === antes.value?.convenio)
    .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
);
const especialidades = computed(() => [
  { valor: '', rotulo: t('atendimento.escolha') },
  ...(apoio.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const profissionais = computed(() =>
  (apoio.data.value?.profissionais ?? [])
    .filter(
      (p) =>
        !especialidade.value ||
        p.especialidades.includes(Number(especialidade.value)) ||
        String(p.id) === profissional.value,
    )
    .map((p) => ({ valor: String(p.id), rotulo: `${p.nome} · ${p.crm}` })),
);
const caracteres = CARATERES.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }));

// Buscas (procedimento na tabela do convênio escolhido, CID e solicitante).
const termoProcedimento = ref('');
const termoCid = ref('');
const termoCid2 = ref('');
const termoSolicitante = ref('');
const procedimentos = ref<{ codigo: number; nome: string }[]>([]);
const cids = ref<{ id: number; codigo: string; nome: string }[]>([]);
const cids2 = ref<{ id: number; codigo: string; nome: string }[]>([]);
const solicitantes = ref<{ id: number; nome: string; registro: string }[]>([]);
const erroBusca = ref<unknown>(null);
async function procurar(f: () => Promise<void>): Promise<void> {
  erroBusca.value = null;
  try {
    await f();
  } catch (e) {
    erroBusca.value = e;
  }
}
const procurarProcedimento = () =>
  procurar(
    async () =>
      void (procedimentos.value = await buscarProcedimentosAtendimento(
        Number(convenio.value),
        termoProcedimento.value.trim(),
      )),
  );
const procurarCid = () => procurar(async () => void (cids.value = await buscarCid(termoCid.value.trim())));
const procurarCid2 = () => procurar(async () => void (cids2.value = await buscarCid(termoCid2.value.trim())));
const procurarSolicitante = () =>
  procurar(
    async () =>
      void (solicitantes.value = await buscarSolicitantesAtendimento(termoSolicitante.value.trim())),
  );
function escolherProcedimento(p: { codigo: number; nome: string }): void {
  procedimento.value = String(p.codigo);
  procedimentoNome.value = `${p.codigo} · ${p.nome}`;
  procedimentos.value = [];
}

// Gravação: revisar (diálogo com a justificativa) e gravar só o que mudou.
const podeGravar = computed(
  () => pode('atendimento.alterarAtendimento').value && !ficha.data.value?.desfecho,
);
const mudancas = computed(() =>
  antes.value ? entradaDaCorrecao(antes.value, agora.value, '', ficha.data.value?.versao ?? '') : null,
);
const quantasMudancas = computed(() =>
  mudancas.value
    ? Object.keys(mudancas.value).filter((k) => k !== 'justificativa' && k !== 'versao').length
    : 0,
);
const revisando = ref(false);
const justificativa = ref('');
const chave = ref(novaChave('corrigir'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const colisao = computed(() =>
  erro.value instanceof ErroApi &&
  erro.value.problema &&
  tipoDoProblema(erro.value.problema) === 'conflito-de-versao'
    ? erro.value.problema
    : null,
);
async function gravar(): Promise<void> {
  const f = ficha.data.value;
  if (!f || !antes.value) return;
  const e = entradaDaCorrecao(antes.value, agora.value, justificativa.value, f.versao);
  if (!e || justificativa.value.trim().length < 10) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await alterarAtendimento(reg.value, e, chave.value);
    mensagem.value = r.mensagem;
    revisando.value = false;
    justificativa.value = '';
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
    revisando.value = false;
  } finally {
    chave.value = novaChave('corrigir');
    ocupado.value = false;
  }
}
async function reler(): Promise<void> {
  erro.value = null;
  await ficha.refetch();
  preencher();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="corrigir-titulo" data-testid="tela-corrigir-ficha">
    <h1 id="corrigir-titulo">{{ t('atendimento.corrigir.titulo') }}</h1>
    <p>{{ t('atendimento.corrigir.texto') }}</p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <ErroAtendimento v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value || !apoio.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <ResumoAtendimento :atendimento="ficha.data.value" atalhos />
      <SanteAlerta
        v-if="ficha.data.value.desfecho"
        variante="info"
        :texto="t('atendimento.corrigir.encerrado')"
      />
      <form v-else class="painel" @submit.prevent="revisando = mudancas !== null">
        <div class="filtros">
          <SanteSelecao v-model="convenio" :rotulo="t('atendimento.convenio')" :opcoes="convenios" />
          <SanteSelecao
            v-model="especialidade"
            :rotulo="t('atendimento.especialidade')"
            :opcoes="especialidades"
          />
          <SanteSelecao
            v-model="profissional"
            :rotulo="t('atendimento.profissional')"
            :opcoes="profissionais"
          />
        </div>
        <SanteOpcoes
          v-if="caracteres.length"
          v-model="carater"
          :legenda="t('atendimento.carater')"
          :opcoes="caracteres"
        />

        <p data-testid="corrigir-procedimento">
          {{ t('atendimento.corrigir.procedimento') }}: {{ procedimentoNome }}
        </p>
        <div class="filtros" role="search">
          <div class="campo">
            <label for="corrigir-termo-proc">{{ t('atendimento.corrigir.buscarProcedimento') }}</label>
            <input id="corrigir-termo-proc" v-model="termoProcedimento" type="search" autocomplete="off" />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="t('atendimento.buscar')"
            data-testid="corrigir-buscar-proc"
            @acionar="procurarProcedimento"
          />
        </div>
        <ul v-if="procedimentos.length" class="lista-simples">
          <li v-for="p in procedimentos" :key="p.codigo">
            <SanteBotao
              variante="texto"
              :rotulo="`${p.codigo} · ${p.nome}`"
              :data-testid="`corrigir-proc-${p.codigo}`"
              @acionar="escolherProcedimento(p)"
            />
          </li>
        </ul>

        <div class="filtros" role="search">
          <div class="campo">
            <label for="corrigir-cid">{{ t('atendimento.corrigir.cidPrincipal') }}</label>
            <input id="corrigir-cid" v-model="termoCid" type="search" autocomplete="off" />
          </div>
          <SanteBotao variante="secundario" :rotulo="t('atendimento.buscar')" @acionar="procurarCid" />
        </div>
        <p v-if="cidPrincipal" class="acoes" data-testid="corrigir-cid-escolhido">
          {{ cidPrincipal.rotulo }}
          <SanteBotao variante="texto" :rotulo="t('atendimento.trocar')" @acionar="cidPrincipal = null" />
        </p>
        <ul v-else-if="cids.length" class="lista-simples">
          <li v-for="c in cids" :key="c.id">
            <SanteBotao
              variante="texto"
              :rotulo="`${c.codigo} · ${c.nome}`"
              @acionar="((cidPrincipal = { id: c.id, rotulo: `${c.codigo} · ${c.nome}` }), (cids = []))"
            />
          </li>
        </ul>

        <div class="filtros" role="search">
          <div class="campo">
            <label for="corrigir-cid2">{{ t('atendimento.corrigir.cidSecundario') }}</label>
            <input id="corrigir-cid2" v-model="termoCid2" type="search" autocomplete="off" />
          </div>
          <SanteBotao variante="secundario" :rotulo="t('atendimento.buscar')" @acionar="procurarCid2" />
        </div>
        <p v-if="cidSecundario" class="acoes" data-testid="corrigir-cid2-escolhido">
          {{ cidSecundario.rotulo }}
          <SanteBotao
            variante="texto"
            :rotulo="t('atendimento.corrigir.remover')"
            data-testid="corrigir-remover-cid2"
            @acionar="cidSecundario = null"
          />
        </p>
        <p v-else-if="gravados.cidSecundario" class="secundario" data-testid="corrigir-cid2-retirado">
          {{ t('atendimento.corrigir.seraRetirado', { valor: gravados.cidSecundario }) }}
        </p>
        <ul v-else-if="cids2.length" class="lista-simples">
          <li v-for="c in cids2" :key="c.id">
            <SanteBotao
              variante="texto"
              :rotulo="`${c.codigo} · ${c.nome}`"
              @acionar="((cidSecundario = { id: c.id, rotulo: `${c.codigo} · ${c.nome}` }), (cids2 = []))"
            />
          </li>
        </ul>

        <div class="filtros" role="search">
          <div class="campo">
            <label for="corrigir-solicitante">{{ t('atendimento.corrigir.solicitante') }}</label>
            <input id="corrigir-solicitante" v-model="termoSolicitante" type="search" autocomplete="off" />
          </div>
          <SanteBotao
            variante="secundario"
            :rotulo="t('atendimento.buscar')"
            @acionar="procurarSolicitante"
          />
        </div>
        <p v-if="solicitante" class="acoes" data-testid="corrigir-solicitante-escolhido">
          {{ solicitante.rotulo }}
          <SanteBotao
            variante="texto"
            :rotulo="t('atendimento.corrigir.remover')"
            data-testid="corrigir-remover-solicitante"
            @acionar="solicitante = null"
          />
        </p>
        <p v-else-if="gravados.solicitante" class="secundario" data-testid="corrigir-solicitante-retirado">
          {{ t('atendimento.corrigir.seraRetirado', { valor: gravados.solicitante }) }}
        </p>
        <ul v-else-if="solicitantes.length" class="lista-simples">
          <li v-for="s in solicitantes" :key="s.id">
            <SanteBotao
              variante="texto"
              :rotulo="`${s.nome} · ${s.registro}`"
              @acionar="
                ((solicitante = { id: s.id, rotulo: `${s.nome} · ${s.registro}` }), (solicitantes = []))
              "
            />
          </li>
        </ul>
        <ErroAtendimento v-if="erroBusca" :erro="erroBusca" />

        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('atendimento.corrigir.observacao')"
          :max-bytes="400"
          multilinha
          data-testid="corrigir-observacao"
        />
        <p v-if="gravados.observacao" class="acoes">
          <span v-if="observacao.trim() === ''" class="secundario" data-testid="corrigir-observacao-retirada">
            {{ t('atendimento.corrigir.seraRetirado', { valor: gravados.observacao }) }}
          </span>
          <SanteBotao
            v-else
            variante="texto"
            :rotulo="t('atendimento.corrigir.remover')"
            data-testid="corrigir-remover-observacao"
            @acionar="observacao = ''"
          />
        </p>
        <p class="secundario">{{ t('atendimento.corrigir.contaFaturamento') }}</p>
        <p class="acoes">
          <SanteBotao
            v-if="podeGravar"
            tipo="submit"
            :rotulo="t('atendimento.corrigir.revisar')"
            :desabilitado="ocupado || mudancas === null"
            data-testid="botao-revisar-correcao"
          />
          <span v-else class="secundario">{{ t('atendimento.semAcao') }}</span>
          <span v-if="podeGravar" class="secundario" data-testid="corrigir-mudancas">
            {{
              mudancas === null
                ? t('atendimento.corrigir.nadaMudou')
                : t('atendimento.corrigir.mudancas', { n: quantasMudancas })
            }}
          </span>
        </p>
        <p v-if="mensagem" role="status" data-testid="ficha-corrigida">{{ mensagem }}</p>
      </form>
      <SanteAvisoColisao v-if="colisao" :problema="colisao" @rever="reler" @descartar="reler" />
      <ErroAtendimento v-else-if="erro" :erro="erro" />
      <SanteDialogo v-model:visivel="revisando" :titulo="t('atendimento.corrigir.confirmarTitulo')">
        <form class="filtros" data-testid="dialogo-correcao" @submit.prevent="gravar">
          <p>{{ t('atendimento.corrigir.confirmarTexto') }}</p>
          <p>{{ t('atendimento.corrigir.mudancas', { n: quantasMudancas }) }}</p>
          <SanteCampoTexto
            id="corrigir-justificativa"
            v-model="justificativa"
            :rotulo="t('atendimento.corrigir.justificativa')"
            :max-bytes="200"
            obrigatorio
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('atendimento.corrigir.gravar')"
            :desabilitado="ocupado || justificativa.trim().length < 10"
            data-testid="botao-gravar-correcao"
          />
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
